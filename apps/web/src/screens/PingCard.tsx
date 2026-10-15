import { useState } from 'react';
import { useT } from '../i18n/index.js';
import type { Band, Label } from '../i18n/strings.js';
import type { AnswerBody, ShopPing } from '../lib/api.js';
import { formatRupees, rupeesToPaise } from '../lib/money.js';

function Words({ label }: { label: Label }) {
  return (
    <>
      <span className="label-main">{label.main}</span>
      {label.sub && <span className="label-sub">{label.sub}</span>}
    </>
  );
}

interface Props {
  ping: ShopPing;
  /** True while an answer is on its way; the buttons wait. */
  busy?: boolean;
  onAnswer: (body: AnswerBody) => void;
}

/**
 * One question, two big buttons. "Haan hai" opens an optional price and a "few / plenty" chip; the
 * shopkeeper can always skip both. The card never decides what happens next: the parent does.
 */
export function PingCard({ ping, busy = false, onAnswer }: Props) {
  const { t } = useT();
  const [step, setStep] = useState<'ask' | 'details'>('ask');
  const [price, setPrice] = useState('');
  const [hint, setHint] = useState<'few' | 'plenty' | null>(null);
  const [priceError, setPriceError] = useState(false);

  const band = t.bands[ping.distanceBand as Band] ?? ping.distanceBand;
  const quantity = ping.quantity ? `${ping.quantity.quantity} ${ping.quantity.unit}` : null;

  function sendYes() {
    const body: AnswerBody = { answer: 'yes' };
    if (price.trim() !== '') {
      const parsed = rupeesToPaise(price);
      if (!parsed.ok) {
        setPriceError(true);
        return;
      }
      body.pricePaise = parsed.paise;
    }
    if (hint) body.quantityHint = hint;
    setPriceError(false);
    onAnswer(body);
  }

  return (
    <article className="card" aria-busy={busy}>
      <h1 className="item-hi" lang="hi">
        {ping.item.nameHi}
      </h1>
      <p className="item-en" lang="en">
        {ping.item.nameEn}
      </p>
      {quantity && <p className="detail">{t.quantityLine(quantity)}</p>}
      {ping.targetPricePaise !== undefined && (
        <p className="target">{t.targetLine(formatRupees(ping.targetPricePaise))}</p>
      )}
      <p className="detail">{t.customerDistance(band)}</p>

      {step === 'ask' ? (
        <div className="actions">
          <button
            type="button"
            className="btn btn-yes"
            disabled={busy}
            onClick={() => setStep('details')}
          >
            <Words label={t.yes} />
          </button>
          <button
            type="button"
            className="btn btn-no"
            disabled={busy}
            onClick={() => onAnswer({ answer: 'no' })}
          >
            <Words label={t.no} />
          </button>
        </div>
      ) : (
        <form
          className="details"
          onSubmit={(event) => {
            event.preventDefault();
            sendYes();
          }}
        >
          <label className="field">
            <span>{t.priceLabel}</span>
            <input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
            />
          </label>
          {priceError && (
            <p className="alert" role="alert">
              {t.badPrice}
            </p>
          )}
          <div className="chips-title" id="quantity-title">
            <Words label={t.quantityTitle} />
          </div>
          <div className="chips" role="group" aria-labelledby="quantity-title">
            {(['few', 'plenty'] as const).map((value) => (
              <button
                key={value}
                type="button"
                className="chip"
                aria-pressed={hint === value}
                onClick={() => setHint(hint === value ? null : value)}
              >
                {value === 'few' ? t.few : t.plenty}
              </button>
            ))}
          </div>
          <div className="actions">
            <button type="submit" className="btn btn-yes" disabled={busy}>
              {t.send}
            </button>
            <button
              type="button"
              className="btn btn-quiet"
              disabled={busy}
              onClick={() => onAnswer({ answer: 'yes' })}
            >
              {t.skip}
            </button>
          </div>
        </form>
      )}
    </article>
  );
}
