import { useState } from 'react';
import { useT } from '../../i18n/index.js';
import type { MyShop, ShopApi } from '../../lib/api.js';
import { parseFee } from '../../lib/offer.js';
import { priceInput } from '../lib/answer.js';
import { Button } from '../ui/Button.js';
import { Chip } from '../ui/Chip.js';
import { Field } from '../ui/Field.js';
import { Switch } from '../ui/Switch.js';
import { useToast } from '../ui/Toast.js';

const MINUTES = [15, 30, 60] as const;

interface Props {
  api: Pick<ShopApi, 'updateShop'>;
  shop: MyShop;
  onSaved: (shop: MyShop) => void;
}

/** Delivery: whether the shop delivers, the usual fee and time, and how far. One Save. */
export function Delivery({ api, shop, onSaved }: Props) {
  const { t } = useT();
  const s = t.shop;
  const toast = useToast();
  const [delivers, setDelivers] = useState(shop.deliversDefault);
  const [fee, setFee] = useState(priceInput(shop.defaultFeePaise));
  const [minutes, setMinutes] = useState<number | null>(shop.defaultMinutes);
  const [km, setKm] = useState(shop.deliveryMaxKm == null ? '' : String(shop.deliveryMaxKm));
  const [errors, setErrors] = useState<{ fee?: string; km?: string }>({});
  const [busy, setBusy] = useState(false);

  async function save() {
    const next: typeof errors = {};
    const feePaise = fee.trim() === '' ? null : parseFee(fee);
    if (delivers && fee.trim() !== '' && feePaise === null) next.fee = s.errFee;
    const limit = km.trim() === '' ? null : Number(km.replace(',', '.'));
    if (delivers && limit !== null && !(Number.isFinite(limit) && limit >= 0.1 && limit <= 100))
      next.km = s.errKm;
    setErrors(next);
    if (next.fee || next.km) return;

    setBusy(true);
    try {
      const saved = await api.updateShop({
        delivery: delivers
          ? {
              ...(feePaise !== null && { feePaise }),
              ...(minutes !== null && { minutes }),
            }
          : null,
        deliveryMaxKm: delivers ? limit : null,
      });
      onSaved(saved);
      toast(s.saved);
    } catch {
      toast(s.sendFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="sh-title">{s.deliveryTitle}</h1>
      <section className="sh-card sh-stack">
        <Switch checked={delivers} onChange={setDelivers} label={s.iDeliver} />
        {delivers && (
          <>
            <Field
              label={s.defaultFee}
              inputMode="decimal"
              autoComplete="off"
              value={fee}
              error={errors.fee ?? null}
              onChange={(event) => setFee(event.target.value)}
            />
            <div className="sh-field">
              <span className="sh-label">{s.usualTime}</span>
              <div className="sh-chips">
                {MINUTES.map((m) => (
                  <Chip key={m} pressed={minutes === m} onClick={() => setMinutes(m)}>
                    {m === 15 ? s.min15 : m === 30 ? s.min30 : s.hour1}
                  </Chip>
                ))}
              </div>
            </div>
            <Field
              label={s.upToKm}
              inputMode="decimal"
              autoComplete="off"
              helper={s.noLimit}
              value={km}
              error={errors.km ?? null}
              onChange={(event) => setKm(event.target.value)}
            />
          </>
        )}
      </section>
      <Button
        variant="primary"
        className="sh-btn--block"
        disabled={busy}
        onClick={() => void save()}
      >
        {s.save}
      </Button>
    </>
  );
}
