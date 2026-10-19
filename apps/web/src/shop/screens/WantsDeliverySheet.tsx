import { useState } from 'react';
import { useT } from '../../i18n/index.js';
import type { AnswerBody } from '../../lib/api.js';
import { formatRupees } from '../../lib/money.js';
import { parseFee } from '../../lib/offer.js';
import { parsePrice, priceInput } from '../lib/answer.js';
import { formatQuantity } from '../lib/format.js';
import { BottomSheet } from '../ui/BottomSheet.js';
import { Button } from '../ui/Button.js';
import { Chip } from '../ui/Chip.js';
import { Field } from '../ui/Field.js';
import type { SheetProps } from './AnswerSheet.js';

type Choice = 'deliver' | 'nodeliver' | 'none';
const MINUTES = [15, 30, 60] as const;

/** Sheet E: the customer wants it delivered, so the shop has three honest answers. */
export function WantsDeliverySheet({ ping, shop, onSubmit, onClose }: SheetProps) {
  const { t } = useT();
  const s = t.shop;
  const asked = formatQuantity(ping.quantity);
  const band = t.bands[ping.distanceBand as keyof typeof t.bands] ?? ping.distanceBand;
  const [choice, setChoice] = useState<Choice | null>(null);
  const [price, setPrice] = useState(priceInput(ping.lastPricePaise));
  const [fee, setFee] = useState(priceInput(shop.defaultFeePaise));
  const [minutes, setMinutes] = useState<number>(
    MINUTES.find((m) => m === shop.defaultMinutes) ?? 30,
  );
  const [errors, setErrors] = useState<{ price?: string; fee?: string }>({});
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const paise = parsePrice(price);
  const feePaise = parseFee(fee);
  const total =
    typeof paise === 'number' && feePaise !== null ? formatRupees(paise + feePaise) : null;

  async function confirm() {
    let body: AnswerBody;
    if (choice === 'deliver') {
      const next: typeof errors = {};
      if (typeof paise !== 'number') next.price = s.priceInvalid;
      if (feePaise === null) next.fee = s.errFee;
      setErrors(next);
      if (next.price || next.fee || typeof paise !== 'number' || feePaise === null) return;
      body = { answer: 'yes', pricePaise: paise, delivery: { feePaise, minutes } };
    } else if (choice === 'nodeliver') {
      body = { answer: 'yes' };
    } else {
      body = { answer: 'no' };
    }
    setBusy(true);
    setFailed(false);
    try {
      await onSubmit(body);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  const radio = (value: Choice, label: string) => (
    <label className="sh-radio">
      <input
        type="radio"
        name="answer"
        checked={choice === value}
        onChange={() => setChoice(value)}
      />
      {label}
    </label>
  );

  return (
    <BottomSheet
      open
      title={s.sheetTitle(ping.item.nameEn, asked)}
      onClose={onClose}
      footer={
        <Button
          variant="primary"
          className="sh-btn--block"
          disabled={busy || choice === null}
          onClick={() => void confirm()}
        >
          {s.confirm}
        </Button>
      }
    >
      <p className="sh-caption">{s.wantsDeliveryCaption(band)}</p>
      <fieldset className="sh-radios">
        <legend className="sh-label sh-visually-hidden">{s.answerChoices}</legend>
        {ping.canDeliver ? (
          radio('deliver', s.willDeliver)
        ) : (
          <p className="sh-radio sh-radio--muted">{s.cantDeliverFar}</p>
        )}
        {radio('nodeliver', s.haveCantDeliver)}
        {radio('none', s.notAvailable)}
      </fieldset>
      {choice === 'deliver' && (
        <>
          <Field
            label={s.price}
            inputMode="decimal"
            autoComplete="off"
            prefix="₹"
            value={price}
            error={errors.price ?? null}
            onChange={(event) => setPrice(event.target.value)}
          />
          <Field
            label={s.deliveryFeeLabel}
            inputMode="decimal"
            autoComplete="off"
            prefix="₹"
            value={fee}
            helper={s.fromDeliverySettings}
            error={errors.fee ?? null}
            onChange={(event) => setFee(event.target.value)}
          />
          <div className="sh-field">
            <span className="sh-label">{s.canReachIn}</span>
            <div className="sh-chips">
              {MINUTES.map((m) => (
                <Chip key={m} pressed={minutes === m} onClick={() => setMinutes(m)}>
                  {m === 15 ? s.min15 : m === 30 ? s.min30 : s.hour1}
                </Chip>
              ))}
            </div>
          </div>
          {total && <p className="sh-heading">{s.customerPaysCash(total)}</p>}
          <p className="sh-helper">{s.committed}</p>
        </>
      )}
      {failed && (
        <p role="alert" className="sh-alert">
          {s.sendFailed}
        </p>
      )}
    </BottomSheet>
  );
}
