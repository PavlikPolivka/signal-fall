import type { ClientState } from '../game/state';

const BASE = import.meta.env.BASE_URL;
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

/**
 * Rendered icon of a unit or building, with its team-colored areas tinted
 * (the mask multiplied over the image). Nothing when the faction has no art yet.
 */
export function Icon({ state, faction, id, color }: { state: ClientState; faction: string; id: string; color?: number }) {
  if (!state.art.has(faction)) return null;
  const url = `${BASE}assets/icons/${faction}/${id}`;
  return (
    <span class="icon" aria-hidden="true">
      <img src={`${url}.png`} alt="" draggable={false} />
      {color !== undefined && <i class="tint" style={{ background: hex(color), maskImage: `url(${url}.mask.png)`, WebkitMaskImage: `url(${url}.mask.png)` }} />}
    </span>
  );
}
