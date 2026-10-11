/** The Signal Fall wordmark: stencil letters and a signal-strength mark whose last bar is falling. */
export function Logo({ size = 44 }: { size?: number }) {
  return (
    <div class="logo" style={{ fontSize: `${size}px` }} aria-label="Signal Fall">
      <svg viewBox="0 0 40 40" width={size * 0.9} height={size * 0.9} aria-hidden="true">
        <rect x="2" y="26" width="7" height="10" fill="currentColor" />
        <rect x="12" y="18" width="7" height="18" fill="currentColor" />
        <rect x="22" y="10" width="7" height="26" fill="currentColor" opacity="0.85" />
        <rect x="31" y="3" width="7" height="22" fill="#3ee6ff" transform="rotate(24 34 14)" />
      </svg>
      <span>
        Signal <b>Fall</b>
      </span>
    </div>
  );
}
