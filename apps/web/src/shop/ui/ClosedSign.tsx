/**
 * A shop sign hanging from a nail by a string, tilted a little. Still: it never moves. Drawn in
 * brand and ink tokens (see .sh-closed-sign in screens.css), not paper.
 */
export function ClosedSign({ word }: { word: string }) {
  return (
    <svg
      className="sh-closed-sign"
      viewBox="0 0 200 170"
      width="200"
      height="170"
      aria-hidden="true"
      focusable="false"
    >
      <g transform="rotate(-4 100 14)">
        <path className="sh-closed-sign__string" d="M100 14 L56 70 M100 14 L144 70" />
        <rect className="sh-closed-sign__board" x="20" y="68" width="160" height="74" rx="10" />
        <rect className="sh-closed-sign__edge" x="28" y="76" width="144" height="58" rx="6" />
        <circle className="sh-closed-sign__hole" cx="56" cy="70" r="3.5" />
        <circle className="sh-closed-sign__hole" cx="144" cy="70" r="3.5" />
        <text className="sh-closed-sign__word" x="100" y="115" textAnchor="middle">
          {word}
        </text>
      </g>
      <circle className="sh-closed-sign__nail" cx="100" cy="14" r="6" />
    </svg>
  );
}
