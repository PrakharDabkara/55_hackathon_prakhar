import { useEffect, useState } from 'react';
import '../customer/orders.css';
import { useT } from '../i18n/index.js';
import type { PendingPickup, PickupAnswer, PickupApi } from '../lib/pickupApi.js';
import { Button } from '../ui/Button.js';

const ANSWERS: { answer: PickupAnswer; key: 'pickupFound' | 'pickupNotThere' | 'pickupNotGone' }[] =
  [
    { answer: 'found', key: 'pickupFound' },
    { answer: 'not_there', key: 'pickupNotThere' },
    { answer: 'not_gone', key: 'pickupNotGone' },
  ];

/**
 * "Did you get it?": after the customer tapped Directions, one question at a time at the top of
 * My orders. The answer keeps what shops told us honest (ADR-0035). Best effort: if it cannot be
 * fetched there is simply no question.
 */
export function PickupAsk({ api }: { api: Pick<PickupApi, 'pendingPickups' | 'answerPickup'> }) {
  const { t } = useT();
  const c = t.c;
  const [waiting, setWaiting] = useState<PendingPickup[]>([]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [thanked, setThanked] = useState(false);

  useEffect(() => {
    let alive = true;
    api.pendingPickups().then(
      (next) => alive && setWaiting(next),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [api]);

  const current = waiting[0];
  if (!current) {
    return thanked ? (
      <p className="sh-helper" role="status">
        {c.pickupThanks}
      </p>
    ) : null;
  }

  async function answer(choice: PickupAnswer) {
    if (!current) return;
    setBusy(true);
    setFailed(false);
    try {
      await api.answerPickup(current.id, choice);
      setWaiting((all) => all.filter((p) => p.id !== current.id));
      setThanked(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="cu-pickup"
      aria-label={c.pickupQuestion(current.item.nameEn, current.shop.name)}
    >
      <div className="cu-section">
        <p className="sh-heading">{c.pickupQuestion(current.item.nameEn, current.shop.name)}</p>
        <p className="sh-helper">{c.pickupHelp}</p>
      </div>
      <div className="cu-pickup__answers">
        {ANSWERS.map(({ answer: choice, key }) => (
          <Button
            key={choice}
            variant="secondary"
            disabled={busy}
            onClick={() => void answer(choice)}
          >
            {c[key]}
          </Button>
        ))}
      </div>
      {failed && (
        <p className="sh-alert" role="alert">
          {c.pickupError}
        </p>
      )}
    </section>
  );
}
