import { useEffect, useState } from 'react';
import { useT } from '../i18n/index.js';
import type { PendingPickup, PickupAnswer, PickupApi } from '../lib/pickupApi.js';

const ANSWERS: { answer: PickupAnswer; key: 'pickupFound' | 'pickupNotThere' | 'pickupNotGone' }[] =
  [
    { answer: 'found', key: 'pickupFound' },
    { answer: 'not_there', key: 'pickupNotThere' },
    { answer: 'not_gone', key: 'pickupNotGone' },
  ];

/**
 * "Le liya?": after the customer tapped "Raasta", one question at a time on the home screen. The
 * answer keeps what shops told us honest (ADR-0035). Best effort: if it cannot be fetched there is
 * simply no question.
 */
export function PickupAsk({ api }: { api: Pick<PickupApi, 'pendingPickups' | 'answerPickup'> }) {
  const { t } = useT();
  const [waiting, setWaiting] = useState<PendingPickup[]>([]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

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
  if (!current) return null;

  async function answer(choice: PickupAnswer) {
    if (!current) return;
    setBusy(true);
    setFailed(false);
    try {
      await api.answerPickup(current.id, choice);
      setWaiting((all) => all.filter((p) => p.id !== current.id));
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="pickup-ask" aria-live="polite">
      <p className="pickup-question">{t.pickupQuestion(current.item.nameEn, current.shop.name)}</p>
      <div className="pickup-answers">
        {ANSWERS.map(({ answer: choice, key }) => (
          <button
            key={choice}
            type="button"
            className={choice === 'found' ? 'btn btn-yes' : 'btn btn-quiet'}
            disabled={busy}
            onClick={() => void answer(choice)}
          >
            {t[key]}
          </button>
        ))}
      </div>
      {failed && (
        <p className="alert" role="alert">
          {t.pickupError}
        </p>
      )}
    </section>
  );
}
