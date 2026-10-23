import { expect, test, type Page } from '@playwright/test';
import keymap from '../packages/data/json/keymap.json' with { type: 'json' };

// M2 acceptance: every keymap.json entry, pressed for real, has its effect.
// New keymap entries without an expectation here fail the test on purpose.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Win = { __signalFall: any };
const ev = <T>(page: Page, fn: (arg: number) => T, arg = 0) => page.evaluate(fn, arg);

/** Playwright key name for a keymap chord ("Ctrl+Digit#" -> "Control+Digit3"). */
const toKey = (chord: string, digit = 3) => chord.replace('Ctrl', 'Control').replace('Digit#', `Digit${digit}`).replace('F#', `F${Math.min(4, Math.max(1, digit))}`);

async function selectOwnUnits(page: Page, filter: 'army' | 'all' = 'all') {
  await ev(page, (army) => {
    const s = (window as unknown as Win).__signalFall.state;
    const out: number[] = [];
    for (let i = 0; i < s.cur.entityCount; i++) {
      const h = s.cur.get(s.cur.ent(i), 0);
      if (s.isOwn(h) && s.isUnit(h) && (!army || s.ruleOf(h).weapon)) out.push(h);
    }
    s.select(out.slice(0, 12));
  }, filter === 'army' ? 1 : 0);
}

const state = (page: Page) =>
  ev(page, () => {
    const s = (window as unknown as Win).__signalFall.state;
    const r = (window as unknown as Win).__signalFall.renderer;
    return {
      mode: s.mode as string,
      selection: s.selection.length as number,
      subgroup: s.subgroup as number,
      menuOpen: s.menuOpen as boolean,
      cam: { x: r.camera.x as number, y: r.camera.y as number },
      lastSent: (s.sent[s.sent.length - 1]?.type ?? null) as string | null,
      groups: s.controlGroups.map((g: number[]) => g.length) as number[],
      sidebarTab: s.sidebarTab as string,
    };
  });

type Check = (page: Page, chord: string) => Promise<void>;

const pan = (dx: number, dy: number): Check => async (page, chord) => {
  const before = (await state(page)).cam;
  await page.keyboard.down(toKey(chord));
  // Hold until the camera has moved: software-rendered CI browsers may only get a few frames in.
  await expect
    .poll(async () => {
      const cam = (await state(page)).cam;
      return [dx ? Math.sign(cam.x - before.x) : 0, dy ? Math.sign(cam.y - before.y) : 0];
    }, { timeout: 5000 })
    .toEqual([dx, dy]);
  await page.keyboard.up(toKey(chord));
};

const setsMode = (mode: string): Check => async (page, chord) => {
  await selectOwnUnits(page, 'army');
  await page.keyboard.press(toKey(chord));
  expect((await state(page)).mode).toBe(mode);
  await page.keyboard.press('Escape');
};

const sends = (type: string): Check => async (page, chord) => {
  await selectOwnUnits(page);
  await page.keyboard.press(toKey(chord));
  expect((await state(page)).lastSent).toBe(type);
};

const unitMenu = (mode: string, tab: string): Check => async (page, chord) => {
  await ev(page, () => (window as unknown as Win).__signalFall.state.select([]));
  await page.keyboard.press(toKey(chord));
  const st = await state(page);
  expect(st.mode).toBe(mode);
  expect(st.sidebarTab).toBe(tab);
  await page.keyboard.press('Escape');
};

const checks: Record<string, Check> = {
  panUp: pan(0, -1),
  panDown: pan(0, 1),
  panLeft: pan(-1, 0),
  panRight: pan(1, 0),
  jumpToAlert: async (page, chord) => {
    await ev(page, () => (window as unknown as Win).__signalFall.state.alert('Test alert', 40 * 1024, 40 * 1024));
    await page.keyboard.press(toKey(chord));
    const cam = (await state(page)).cam;
    expect(Math.abs(cam.x - 0)).toBeLessThan(2);
    expect(Math.abs(cam.y - 80 * 16)).toBeLessThan(2);
  },
  jumpToBase: async (page, chord) => {
    await ev(page, () => Object.assign((window as unknown as Win).__signalFall.renderer.camera, { x: 1500, y: 2500 }));
    await page.keyboard.press(toKey(chord));
    const cam = (await state(page)).cam;
    expect(cam.y).toBeLessThan(1000);
  },
  selectArmy: async (page, chord) => {
    await ev(page, () => (window as unknown as Win).__signalFall.state.select([]));
    await page.keyboard.press(toKey(chord));
    expect((await state(page)).selection).toBeGreaterThan(5);
  },
  selectIdleHarvesters: async (page, chord) => {
    await ev(page, () => (window as unknown as Win).__signalFall.state.select([]));
    await page.keyboard.press(toKey(chord));
    expect((await state(page)).selection).toBe(1);
  },
  cycleProduction: async (page, chord) => {
    await ev(page, () => (window as unknown as Win).__signalFall.state.select([]));
    await page.keyboard.press(toKey(chord));
    const kind = await ev(page, () => {
      const s = (window as unknown as Win).__signalFall.state;
      return s.selection.length === 1 ? s.ruleOf(s.selection[0]).kind : null;
    });
    expect(kind).toBe('structure');
  },
  cycleIdleArmy: async (page, chord) => {
    await ev(page, () => (window as unknown as Win).__signalFall.state.select([]));
    await page.keyboard.press(toKey(chord));
    expect((await state(page)).selection).toBe(1);
  },
  selectDamaged: async (page, chord) => {
    // Exactly the own units below full health (none, at the start of the sandbox).
    const damaged = await ev(page, () => {
      const s = (window as unknown as Win).__signalFall.state;
      let n = 0;
      for (let i = 0; i < s.cur.entityCount; i++) {
        const o = s.cur.ent(i);
        const h = s.cur.get(o, 0);
        if (s.isOwn(h) && s.isUnit(h) && s.field(h, 6) < s.field(h, 7)) n++; // E.hp, E.maxHp
      }
      return n;
    });
    await selectOwnUnits(page, 'army');
    await page.keyboard.press(toKey(chord));
    expect((await state(page)).selection).toBe(damaged);
  },
  controlGroupAssign: async (page, chord) => {
    await selectOwnUnits(page, 'army');
    await page.keyboard.press(toKey(chord, 4));
    expect((await state(page)).groups[4]).toBeGreaterThan(0);
  },
  controlGroupAdd: async (page, chord) => {
    await selectOwnUnits(page, 'army');
    await page.keyboard.press('Control+Digit5');
    const before = (await state(page)).groups[5]!;
    await selectOwnUnits(page, 'all');
    await page.keyboard.press(toKey(chord, 5));
    expect((await state(page)).groups[5]).toBeGreaterThan(before);
  },
  controlGroupRemove: async (page, chord) => {
    await selectOwnUnits(page, 'army');
    await page.keyboard.press('Control+Digit7');
    const before = (await state(page)).groups[7]!;
    await ev(page, () => {
      const s = (window as unknown as Win).__signalFall.state;
      s.select(s.selection.slice(0, 1));
    });
    await page.keyboard.press(toKey(chord, 7));
    expect((await state(page)).groups[7]).toBe(before - 1);
  },
  cycleYards: async (page, chord) => {
    await ev(page, () => (window as unknown as Win).__signalFall.state.select([]));
    await page.keyboard.press(toKey(chord));
    const role = await ev(page, () => {
      const s = (window as unknown as Win).__signalFall.state;
      return s.selection.length === 1 ? s.ruleOf(s.selection[0]).role : null;
    });
    expect(role).toBe('conyard');
  },
  followCamera: async (page, chord) => {
    await selectOwnUnits(page, 'army');
    await page.keyboard.press(toKey(chord));
    expect(await ev(page, () => (window as unknown as Win).__signalFall.input.following)).not.toBeNull();
    await page.keyboard.press(toKey(chord));
    expect(await ev(page, () => (window as unknown as Win).__signalFall.input.following)).toBeNull();
  },
  garrisonNearest: async (page, chord) => {
    // Infantry go for the nearest ruins; on a map without any nearby the player is told so.
    await ev(page, () => {
      const s = (window as unknown as Win).__signalFall.state;
      const out: number[] = [];
      for (let i = 0; i < s.cur.entityCount; i++) {
        const h = s.cur.get(s.cur.ent(i), 0);
        if (s.isOwn(h) && s.isUnit(h) && s.ruleOf(h).tab === 'infantry') out.push(h);
      }
      s.select(out.slice(0, 4));
    });
    const ruins = await ev(page, () => (window as unknown as Win).__signalFall.state.terrain.includes(5));
    await page.keyboard.press(toKey(chord));
    if (!ruins) await expect(page.getByTestId('alert')).toContainText('No ruins nearby');
    else await expect.poll(() => ev(page, () => (window as unknown as Win).__signalFall.state.selection.some((h: number) => (window as unknown as Win).__signalFall.state.field(h, 19) > 0))).toBe(true);
  },
  controlGroupSelect: async (page, chord) => {
    await selectOwnUnits(page, 'army');
    await page.keyboard.press('Control+Digit6');
    const n = (await state(page)).groups[6];
    await ev(page, () => (window as unknown as Win).__signalFall.state.select([]));
    await page.keyboard.press(toKey(chord, 6));
    expect((await state(page)).selection).toBe(n);
  },
  cycleSubgroup: async (page, chord) => {
    await selectOwnUnits(page, 'all');
    const before = (await state(page)).subgroup;
    await page.keyboard.press(toKey(chord));
    expect((await state(page)).subgroup).not.toBe(before);
  },
  cancel: async (page, chord) => {
    await selectOwnUnits(page, 'army');
    await page.keyboard.press('KeyA');
    await page.keyboard.press(toKey(chord));
    expect((await state(page)).mode).toBe('normal');
    await page.keyboard.press(toKey(chord));
    expect((await state(page)).selection).toBe(0);
    // Esc never opens the menu (browsers use it to leave fullscreen).
    await page.keyboard.press(toKey(chord));
    expect((await state(page)).menuOpen).toBe(false);
  },
  menu: async (page, chord) => {
    await page.keyboard.press(toKey(chord));
    expect((await state(page)).menuOpen).toBe(true);
    await page.keyboard.press('Escape');
    expect((await state(page)).menuOpen).toBe(false);
  },
  mute: async (page, chord) => {
    const muted = () => page.evaluate(() => (window as unknown as Win).__signalFall.state.muted as boolean);
    const before = await muted();
    await page.keyboard.press(toKey(chord));
    expect(await muted()).toBe(!before);
    await page.keyboard.press(toKey(chord));
    expect(await muted()).toBe(before);
  },
  cameraSave: async (page, chord) => {
    await ev(page, () => Object.assign((window as unknown as Win).__signalFall.renderer.camera, { x: 300, y: 900 }));
    await page.keyboard.press(toKey(chord, 2));
    await ev(page, () => Object.assign((window as unknown as Win).__signalFall.renderer.camera, { x: 0, y: 400 }));
    await page.keyboard.press('F2');
    const cam = (await state(page)).cam;
    expect(Math.round(cam.x)).toBe(300);
    expect(Math.round(cam.y)).toBe(900);
  },
  cameraJump: async (page, chord) => {
    await ev(page, () => Object.assign((window as unknown as Win).__signalFall.renderer.camera, { x: -200, y: 700 }));
    await page.keyboard.press('Control+F3');
    await ev(page, () => Object.assign((window as unknown as Win).__signalFall.renderer.camera, { x: 0, y: 400 }));
    await page.keyboard.press(toKey(chord, 3));
    const cam = (await state(page)).cam;
    expect(Math.round(cam.x)).toBe(-200);
    expect(Math.round(cam.y)).toBe(700);
  },
  speedUp: async (page, chord) => {
    await page.keyboard.press(toKey(chord));
    expect(await ev(page, () => (window as unknown as Win).__signalFall.state.gameSpeed)).toBe(1.5);
  },
  speedDown: async (page, chord) => {
    await page.keyboard.press(toKey(chord));
    expect(await ev(page, () => (window as unknown as Win).__signalFall.state.gameSpeed)).toBe(0.75);
  },
  move: setsMode('move'),
  attackMove: setsMode('attackMove'),
  patrol: setsMode('patrol'),
  guard: setsMode('guard'),
  stop: sends('stop'),
  hold: sends('hold'),
  scatter: sends('scatter'),
  deploy: sends('deploy'),
  // The sandbox army is Holdout: its Grunts and Tankbusters dig in.
  ability: sends('ability'),
  stance: sends('stance'),
  // The sandbox player is Holdout, which has no support power: the key is handled and does nothing.
  supportPower: async (page, chord) => {
    await page.keyboard.press(toKey(chord));
    expect((await state(page)).mode).toBe('normal');
  },
  buildMenu: async (page, chord) => {
    await ev(page, () => (window as unknown as Win).__signalFall.state.select([]));
    await page.keyboard.press(toKey(chord));
    const st = await state(page);
    expect(st.mode).toBe('buildMenu');
    expect(st.sidebarTab).toBe('structures');
    await page.keyboard.press('Escape');
  },
  defenseMenu: async (page, chord) => {
    await ev(page, () => (window as unknown as Win).__signalFall.state.select([]));
    await page.keyboard.press(toKey(chord));
    const st = await state(page);
    expect(st.mode).toBe('defenseMenu');
    expect(st.sidebarTab).toBe('defenses');
    await page.keyboard.press('Escape');
  },
  infantryMenu: unitMenu('infantryMenu', 'infantry'),
  vehicleMenu: unitMenu('vehicleMenu', 'vehicles'),
  airMenu: unitMenu('airMenu', 'air'),
  repair: async (page, chord) => {
    await ev(page, () => (window as unknown as Win).__signalFall.state.select([]));
    await page.keyboard.press(toKey(chord));
    expect((await state(page)).mode).toBe('repair');
    await page.keyboard.press('Escape');
  },
  // Not charged yet at the start: the key says when, like the button.
  superweaponFire: async (page, chord) => {
    await page.keyboard.press(toKey(chord));
    await expect(page.getByTestId('alert')).toContainText('is ready in');
    expect((await state(page)).mode).toBe('normal');
  },
  sell: async (page, chord) => {
    await ev(page, () => (window as unknown as Win).__signalFall.state.select([]));
    await page.keyboard.press(toKey(chord));
    expect((await state(page)).mode).toBe('sell');
    await page.keyboard.press('Escape');
  },
};

const entries: [string, string][] = [];
for (const ctx of ['global', 'units', 'base'] as const) {
  for (const [action, chords] of Object.entries(keymap[ctx] as Record<string, string[]>)) {
    for (const chord of chords) entries.push([action, chord]);
  }
}

test.describe('every keymap entry works', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/play/?scenario=sandbox');
    await page.waitForFunction(() => (window as unknown as Win).__signalFall?.state?.cur);
    // Park the cursor mid-view (outside the edge-scroll zone) with the page focused.
    const box = (await page.locator('[data-testid=game] canvas').boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
  });

  for (const [action, chord] of entries) {
    test(`${action} (${chord})`, async ({ page }) => {
      const check = checks[action];
      expect(check, `no expectation for keymap action "${action}"`).toBeDefined();
      await check!(page, chord);
    });
  }
});

