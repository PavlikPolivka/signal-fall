import { useEffect, useState } from 'preact/hooks';
import type { ClientState } from '../game/state';

const BASE = import.meta.env.BASE_URL;
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

/**
 * Team-colored icons, composited once and cached by icon and color. (A live CSS multiply blend over
 * the game canvas made Firefox recomposite the whole build list every frame: 60 fps down to 13.)
 */
const colored = new Map<string, Promise<string | null>>();

function load(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** The icon with its team areas multiplied by the color (the mask: white, alpha = how much team color). */
function tinted(url: string, color: number): Promise<string | null> {
  const key = `${url}|${color}`;
  let p = colored.get(key);
  if (!p) {
    p = Promise.all([load(`${url}.png`), load(`${url}.mask.png`)])
      .then(([art, mask]) => {
        const w = art.naturalWidth;
        const h = art.naturalHeight;
        // The team color, only where the mask says.
        const tint = document.createElement('canvas');
        tint.width = w;
        tint.height = h;
        const t = tint.getContext('2d')!;
        t.fillStyle = hex(color);
        t.fillRect(0, 0, w, h);
        t.globalCompositeOperation = 'destination-in';
        t.drawImage(mask, 0, 0, w, h);
        // Multiplied over the art, then cut back to the art's own outline.
        const out = document.createElement('canvas');
        out.width = w;
        out.height = h;
        const o = out.getContext('2d')!;
        o.drawImage(art, 0, 0);
        o.globalCompositeOperation = 'multiply';
        o.drawImage(tint, 0, 0);
        o.globalCompositeOperation = 'destination-in';
        o.drawImage(art, 0, 0);
        return out.toDataURL('image/png');
      })
      .catch(() => null);
    colored.set(key, p);
  }
  return p;
}

/** Rendered art for a unit or structure (sidebar, cards), team-colored when a color is given. */
export function Icon({ state, faction, id, color }: { state: ClientState; faction: string; id: string; color?: number }) {
  const url = `${BASE}assets/icons/${faction}/${id}`;
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setSrc(null);
    if (color !== undefined) void tinted(url, color).then((s) => live && setSrc(s));
    return () => {
      live = false;
    };
  }, [url, color]);
  if (!state.art.has(faction)) return null;
  return (
    <span class="icon" aria-hidden="true">
      <img src={src ?? `${url}.png`} alt="" draggable={false} />
    </span>
  );
}
