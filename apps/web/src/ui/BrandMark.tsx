import {
  MARK_HOLE,
  MARK_LINES,
  MARK_PAPER,
  MARK_PIN,
  MARK_RADIUS,
  MARK_SIZE,
} from './brandMarkGeometry.js';

/**
 * The AskBuy mark: a parchi slip with two lines of ink and a marigold pin, on a brand square.
 * Decorative (the name is written next to it) and painted only by tokens (ui.css), never by colours
 * of its own.
 */
export function BrandMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg
      className={`brand-mark${className ? ` ${className}` : ''}`}
      viewBox={`0 0 ${MARK_SIZE} ${MARK_SIZE}`}
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      <rect className="bm-bg" width={MARK_SIZE} height={MARK_SIZE} rx={MARK_RADIUS} />
      <path className="bm-paper" d={MARK_PAPER} />
      {MARK_LINES.map((d) => (
        <path key={d} className="bm-ink" d={d} />
      ))}
      <path className="bm-pin" d={MARK_PIN} />
      <circle className="bm-hole" cx={MARK_HOLE.cx} cy={MARK_HOLE.cy} r={MARK_HOLE.r} />
    </svg>
  );
}
