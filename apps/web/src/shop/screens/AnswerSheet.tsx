import { useState } from 'react';
import { useT } from '../../i18n/index.js';
import type { AnswerBody, MyShop, ShopPing } from '../../lib/api.js';
import { formatRupees } from '../../lib/money.js';
import { parseAmount, type QuantityUnit } from '../../lib/offer.js';
import type { PhotoApi } from '../../lib/photoApi.js';
import { defaultOffer, parsePrice, priceInput } from '../lib/answer.js';
import { displayItemName, formatQuantity } from '../lib/format.js';
import { BottomSheet } from '../../ui/BottomSheet.js';
import { Button } from '../../ui/Button.js';
import { Field } from '../../ui/Field.js';
import { PhotoRow } from '../ui/PhotoRow.js';
import { SegmentedControl } from '../../ui/SegmentedControl.js';
import { Switch } from '../../ui/Switch.js';

export interface SheetProps {
  ping: ShopPing;
  shop: Pick<MyShop, 'deliversDefault' | 'defaultFeePaise' | 'defaultMinutes'>;
  /** Rejects when the answer could not be sent; the sheet stays open and says so. */
  onSubmit: (body: AnswerBody) => Promise<void>;
  onClose: () => void;
}

interface Props extends SheetProps {
  photos: PhotoApi;
  /** For tests: a stand-in for the canvas shrink. */
  preparePhoto?: (file: File) => Promise<Blob>;
}

/** Sheet D: a normal question. In stock (price, quantity, photo, delivery) or Not available. */
export function AnswerSheet({ ping, shop, photos, preparePhoto, onSubmit, onClose }: Props) {
  const { t } = useT();
  const s = t.shop;
  const asked = formatQuantity(ping.quantity);
  const [price, setPrice] = useState(priceInput(ping.lastPricePaise));
  const [amount, setAmount] = useState(ping.quantity ? String(ping.quantity.quantity) : '');
  const [photoId, setPhotoId] = useState<string | null>(null);
  const [delivers, setDelivers] = useState(shop.deliversDefault);
  const [errors, setErrors] = useState<{ price?: string; amount?: string }>({});
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  async function send(body: AnswerBody) {
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

  function sendYes() {
    const body: AnswerBody = { answer: 'yes' };
    const next: typeof errors = {};
    const paise = parsePrice(price);
    if (paise === null) next.price = s.priceInvalid;
    else if (paise !== undefined) body.pricePaise = paise;
    if (ping.quantity && amount.trim() !== '') {
      const parsed = parseAmount(amount);
      if (parsed === null) next.amount = s.quantityInvalid;
      else body.quantity = { amount: parsed, unit: ping.quantity.unit as QuantityUnit };
    }
    setErrors(next);
    if (next.price || next.amount) return;
    if (ping.canDeliver && delivers) body.delivery = defaultOffer(shop);
    if (photoId) body.photoId = photoId;
    void send(body);
  }

  const fee = shop.defaultFeePaise === null ? null : formatRupees(shop.defaultFeePaise);

  return (
    <BottomSheet
      open
      title={s.sheetTitle(displayItemName(ping.item.nameEn), asked)}
      onClose={onClose}
      footer={
        <Button variant="primary" className="sh-btn--block" disabled={busy} onClick={sendYes}>
          {s.send}
        </Button>
      }
    >
      <SegmentedControl
        label={s.answerChoices}
        value="in"
        options={[
          { value: 'in', label: s.inStock },
          { value: 'out', label: s.notAvailable },
        ]}
        onChange={(value) => {
          if (value === 'out' && !busy) void send({ answer: 'no' });
        }}
      />
      <Field
        label={s.priceLabel}
        inputMode="decimal"
        autoComplete="off"
        prefix="₹"
        value={price}
        error={errors.price ?? null}
        {...(ping.lastPricePaise !== null && {
          helper: s.lastTime(formatRupees(ping.lastPricePaise)),
        })}
        onChange={(event) => setPrice(event.target.value)}
      />
      {ping.quantity && (
        <Field
          label={s.quantityLabel(asked)}
          inputMode="decimal"
          autoComplete="off"
          value={amount}
          error={errors.amount ?? null}
          onChange={(event) => setAmount(event.target.value)}
        />
      )}
      <PhotoRow
        api={photos}
        onChange={setPhotoId}
        {...(preparePhoto && { prepare: preparePhoto })}
      />
      {ping.canDeliver && (
        <Switch checked={delivers} onChange={setDelivers} label={s.offerDelivery(fee)} />
      )}
      {failed && (
        <p role="alert" className="sh-alert">
          {s.sendFailed}
        </p>
      )}
    </BottomSheet>
  );
}
