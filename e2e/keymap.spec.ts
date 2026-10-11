import { expect, test, type Page } from '@playwright/test';
import keymap from '../packages/data/json/keymap.json' with { type: 'json' };

// M2 acceptance: every keymap.json entry, pressed for real, has its effect.
// New keymap entries without an expectation here fail the test on purpose.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Win = { __signalFall: any };
const ev = <T>(page: Page, fn: (arg: number) => T, arg = 0) => page.evaluate(fn, arg);

/** Playwright key name for a keymap chord ("Ctrl+Digit#" -> "Control+Digit3"). */
const toKey = (chord: string, digit = 3) => chord.replace('Ctrl', 'Control').replace('Digit#', `Digit${digit}`);

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
  await page.waitForTimeout(300);
  await page.keyboard.up(toKey(chord));
  const after = (await state(page)).cam;
  if (dx) expect(Math.sign(after.x - before.x)).toBe(dx);
  if (dy) expect(Math.sign(after.y - before.y)).toBe(dy);
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
    await page.keyboard.press(toKey(chord));
    expect((await state(page)).menuOpen).toBe(true);
    await page.keyboard.press(toKey(chord));
    expect((await state(page)).menuOpen).toBe(false);
  },
  move: setsMode('move'),
  attackMove: setsMode('attackMove'),
  patrol: setsMode('patrol'),
  guard: setsMode('guard'),
  stop: sends('stop'),
  hold: sends('hold'),
  scatter: sends('scatter'),
  deploy: sends('deploy'),
  ability: sends('ability'),
  stance: sends('stance'),
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
    await page.goto('/?scenario=sandbox');
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
