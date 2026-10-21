/** A hand-drawn tick box: a rounded square set a little crooked, with a green tick when ticked. */
export function TickBox({ on }: { on: boolean }) {
  return (
    <svg className="sh-tick" viewBox="0 0 28 28" width="28" height="28" aria-hidden="true">
      <rect
        className="sh-tick__box"
        x="3.5"
        y="3.5"
        width="21"
        height="21"
        rx="5"
        transform="rotate(-3 14 14)"
      />
      {on && <path className="sh-tick__mark" d="M8 14.6 12.2 19 21 8.6" />}
    </svg>
  );
}
