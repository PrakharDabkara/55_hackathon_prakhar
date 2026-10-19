import { useState } from 'react';
import { useT } from '../../i18n/index.js';
import type { AnswerBody } from '../../lib/api.js';
import { formatRupees } from '../../lib/money.js';
import { parseFee } from '../../lib/offer.js';
import { parsePrice, priceInput } from '../lib/answer.js';
import { displayItemName, formatQuantity } from '../lib/format.js';
import { BottomSheet } from '../../ui/BottomSheet.js';
import { Button } from '../../ui/Button.js';
import { Chip } from '../../ui/Chip.js';
import { Field } from '../../ui/Field.js';
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
  const [feeError, setFeeError] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const paise = parsePrice(price);
  const feePaise = parseFee(fee);
  const total =
    typeof paise === 'number' && feePaise !== null ? formatRupees(paise + feePaise) : null;
  // Promising a delivery needs a price the customer can see: no price, no Confirm.
  const needsPrice = choice === 'deliver' && typeof paise !== 'number';

  async function confirm() {
    let body: AnswerBody;
    if (choice === 'deliver') {
      setFeeError(feePaise === null ? s.errFee : null);
      if (typeof paise !== 'number' || feePaise === null) return;
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
      title={s.sheetTitle(displayItemName(ping.item.nameEn), asked)}
      onClose={onClose}
      footer={
        <div className="sh-sheet__confirm">
          {choice === 'deliver' && total && (
            <p className="sh-heading sh-total">{s.customerPaysCash(total)}</p>
          )}
          <Button
            variant="primary"
            className="sh-btn--block"
            disabled={busy || choice === null || needsPrice}
            onClick={() => void confirm()}
          >
            {s.confirm}
          </Button>
        </div>
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
            placeholder={s.pricePlaceholder}
            value={price}
            {...(price.trim() === '' && { helper: s.enterPrice })}
            error={paise === null ? s.priceInvalid : null}
            onChange={(event) => setPrice(event.target.value)}
          />
          <Field
            label={s.deliveryFeeLabel}
            inputMode="decimal"
            autoComplete="off"
            prefix="₹"
            value={fee}
            helper={s.fromDeliverySettings}
            error={feeError}
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
