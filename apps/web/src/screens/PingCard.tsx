import { useState } from 'react';
import { AuthPhoto } from '../components/AuthPhoto.js';
import { PhotoPicker } from '../components/PhotoPicker.js';
import {
  DeliveryFields,
  deliveryFrom,
  deliveryStateFrom,
  type DeliveryState,
} from '../components/DeliveryFields.js';
import { Words } from '../components/Words.js';
import { useT } from '../i18n/index.js';
import type { Band } from '../i18n/strings.js';
import type { AnswerBody, ShopPing } from '../lib/api.js';
import { formatRupees, rupeesToPaise } from '../lib/money.js';
import { parseAmount, QUANTITY_UNITS, type QuantityUnit } from '../lib/offer.js';
import type { PhotoApi } from '../lib/photoApi.js';

interface Props {
  ping: ShopPing;
  /** The shop's standing delivery offer: a yes starts from it, so a repeat is one tap. */
  defaults?: {
    deliversDefault: boolean;
    defaultFeePaise: number | null;
    defaultMinutes: number | null;
  };
  /** Shows the customer's photo and lets the shop add its own with a yes. Without it, no photos. */
  photos?: PhotoApi;
  /** True while an answer is on its way; the buttons wait. */
  busy?: boolean;
  onAnswer: (body: AnswerBody) => void;
}

/**
 * One question, two big buttons. "Haan hai" opens an optional price and a "few / plenty" chip; the
 * shopkeeper can always skip both. The card never decides what happens next: the parent does.
 */
export function PingCard({ ping, photos, defaults, busy = false, onAnswer }: Props) {
  const { t } = useT();
  const [step, setStep] = useState<'ask' | 'details'>('ask');
  const [price, setPrice] = useState('');
  const [hint, setHint] = useState<'few' | 'plenty' | null>(null);
  const [priceError, setPriceError] = useState(false);
  const [photoId, setPhotoId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [unit, setUnit] = useState<QuantityUnit | null>(null);
  const [delivery, setDelivery] = useState<DeliveryState>(() =>
    deliveryStateFrom(
      defaults?.deliversDefault ?? false,
      defaults?.defaultFeePaise ?? null,
      defaults?.defaultMinutes ?? null,
    ),
  );
  const [unitError, setUnitError] = useState(false);

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
    if (amount.trim() !== '') {
      const parsed = parseAmount(amount);
      // An amount needs a unit and a unit needs a real amount; neither is guessed.
      if (parsed === null || unit === null) {
        setUnitError(true);
        return;
      }
      body.quantity = { amount: parsed, unit };
    }
    const offer = deliveryFrom(delivery);
    if (!offer.ok) {
      setPriceError(true);
      return;
    }
    if (offer.value) body.delivery = offer.value;
    setUnitError(false);
    if (photoId) body.photoId = photoId;
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
      {photos && ping.photoId && <AuthPhoto api={photos} id={ping.photoId} alt={t.photoCustomer} />}

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
          <div className="quantity-fields">
            <label className="field">
              <span>{t.qtyAmountLabel}</span>
              <input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </label>
            <div className="chips" role="group" aria-label="unit">
              {QUANTITY_UNITS.map((u) => (
                <button
                  key={u}
                  type="button"
                  className="chip"
                  aria-pressed={unit === u}
                  onClick={() => setUnit(unit === u ? null : u)}
                >
                  {u === 'l' ? 'L' : u}
                </button>
              ))}
            </div>
            {unitError && (
              <p className="alert" role="alert">
                {t.errUnitNeeded}
              </p>
            )}
          </div>
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
          <DeliveryFields state={delivery} onChange={setDelivery} control="switch" />
          {photos && <PhotoPicker api={photos} role="answer" onChange={setPhotoId} />}
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
