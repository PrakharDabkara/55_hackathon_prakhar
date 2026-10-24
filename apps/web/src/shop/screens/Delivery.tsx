import { useState } from 'react';
import { useT } from '../../i18n/index.js';
import type { MyShop, ShopApi } from '../../lib/api.js';
import { priceInput } from '../lib/answer.js';
import { checkDelivery, type DeliveryForm } from '../lib/delivery.js';
import { Button } from '../../ui/Button.js';
import { useToast } from '../../ui/Toast.js';
import { DeliveryFields } from '../ui/DeliveryFields.js';

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
  const [form, setForm] = useState<DeliveryForm>({
    delivers: shop.deliversDefault,
    fee: priceInput(shop.defaultFeePaise),
    minutes: shop.defaultMinutes,
    km: shop.deliveryMaxKm == null ? '' : String(shop.deliveryMaxKm),
  });
  const [errors, setErrors] = useState<{ fee?: true; km?: true }>({});
  const [busy, setBusy] = useState(false);

  async function save() {
    const checked = checkDelivery(form);
    setErrors(checked.ok ? {} : checked.errors);
    if (!checked.ok) return;

    setBusy(true);
    try {
      const saved = await api.updateShop({
        delivery: checked.delivery,
        deliveryMaxKm: checked.maxKm,
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
        <DeliveryFields value={form} onChange={setForm} errors={errors} />
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
