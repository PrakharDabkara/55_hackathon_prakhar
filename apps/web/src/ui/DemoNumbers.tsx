import { useT } from '../i18n/index.js';
import { Chip } from './Chip.js';

/** The demo-mode line and the demo numbers to tap (A-03). Renders nothing outside demo mode. */
export function DemoNumbers({
  numbers,
  selected,
  onPick,
}: {
  numbers: readonly string[];
  /** The 10 digits now in the field, if they are one of these. */
  selected: string | null;
  onPick: (number: string) => void;
}) {
  const { t } = useT();
  return (
    <section className="km-demo">
      <p className="sh-helper">{t.auth.demoNotice}</p>
      {numbers.length > 0 && (
        <>
          <p className="sh-label">{t.auth.demoChips}</p>
          <div className="sh-chips">
            {numbers.map((number) => (
              <Chip key={number} pressed={selected === number} onClick={() => onPick(number)}>
                {number}
              </Chip>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
