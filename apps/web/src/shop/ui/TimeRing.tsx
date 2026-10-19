import { useT } from '../../i18n/index.js';
import { minutesLeft, ringFraction } from '../lib/format.js';

interface Props {
  startedAt: string;
  expiresAt: string;
  now: number;
}

/** A ring of what is left of the time to reply, with the minutes inside; red under two minutes. */
export function TimeRing({ startedAt, expiresAt, now }: Props) {
  const { t } = useT();
  const minutes = minutesLeft(expiresAt, now);
  const percent = Math.round(ringFraction(startedAt, expiresAt, now) * 100);
  return (
    <span
      className={`sh-ring${minutes < 2 ? ' sh-ring--urgent' : ''}`}
      style={{ '--ring': `${percent}%` } as React.CSSProperties}
    >
      <span className="sh-ring__label">{t.shop.minutesShort(minutes)}</span>
    </span>
  );
}
