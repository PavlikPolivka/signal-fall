import { MARK_BARS, MARK_FALLING, MARK_VIEWBOX } from './mark';

/** The mark alone (signal bars, the last one falling), sized in px. Bars take the current text color. */
export function Mark({ size = 40 }: { size?: number }) {
  const f = MARK_FALLING;
  return (
    <svg viewBox={`0 0 ${MARK_VIEWBOX.width} ${MARK_VIEWBOX.height}`} width={(size * MARK_VIEWBOX.width) / MARK_VIEWBOX.height} height={size} aria-hidden="true">
      {MARK_BARS.map((b) => (
        <rect x={b.x} y={b.y} width={b.width} height={b.height} fill="currentColor" opacity={b.opacity} />
      ))}
      <rect x={f.x} y={f.y} width={f.width} height={f.height} fill="#3ee6ff" transform={`rotate(${f.angle} ${f.cx} ${f.cy})`} />
    </svg>
  );
}

/** The Signal Fall wordmark: stencil letters and a signal-strength mark whose last bar is falling. */
export function Logo({ size = 44 }: { size?: number }) {
  return (
    <div class="logo" style={{ fontSize: `${size}px` }} aria-label="Signal Fall">
      <Mark size={size * 0.9} />
      <span>
        Signal <b>Fall</b>
      </span>
    </div>
  );
}
