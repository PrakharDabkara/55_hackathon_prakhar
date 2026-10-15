import type { Label } from '../i18n/strings.js';

/** A big line with an optional small line below it (Devanagari first, its Latin spelling under it). */
export function Words({ label }: { label: Label }) {
  return (
    <>
      <span className="label-main">{label.main}</span>
      {label.sub && <span className="label-sub">{label.sub}</span>}
    </>
  );
}
