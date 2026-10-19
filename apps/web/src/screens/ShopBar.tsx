import { useState } from 'react';
import {
  DeliveryFields,
  deliveryFrom,
  deliveryStateFrom,
  type DeliveryState,
} from '../components/DeliveryFields.js';
import { useT } from '../i18n/index.js';
import type { MyShop, ShopApi } from '../lib/api.js';

interface Props {
  api: ShopApi;
  shop: MyShop;
  onChange: (shop: MyShop) => void;
}

/**
 * Two small things above the question, both optional: the open / closed switch for the day, and
 * the standing delivery offer (so every yes starts from it). Nothing here blocks a question.
 */
export function ShopBar({ api, shop, onChange }: Props) {
  const { t } = useT();
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [delivery, setDelivery] = useState<DeliveryState>(() =>
    deliveryStateFrom(shop.deliversDefault, shop.defaultFeePaise, shop.defaultMinutes),
  );

  /** How far the shop delivers, in km as typed; empty means no limit. */
  const [limit, setLimit] = useState(shop.deliveryMaxKm == null ? '' : String(shop.deliveryMaxKm));

  async function saveLimit() {
    const km = limit.trim() === '' ? null : Number(limit.replace(',', '.'));
    if (km !== null && !(Number.isFinite(km) && km >= 0.1 && km <= 100)) {
      setError(true);
      return;
    }
    setBusy(true);
    setError(false);
    setSaved(false);
    try {
      onChange(await api.setDeliveryLimit(km));
      setSaved(true);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  async function toggleOpen() {
    setBusy(true);
    setError(false);
    try {
      onChange(await api.setShopOpen(!shop.open));
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  async function saveDelivery() {
    const offer = deliveryFrom(delivery);
    if (!offer.ok) {
      setError(true);
      return;
    }
    setBusy(true);
    setError(false);
    setSaved(false);
    try {
      onChange(await api.updateDelivery(offer.value ?? null));
      setSaved(true);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="shop-bar">
      <button
        type="button"
        role="switch"
        aria-checked={shop.open}
        className={`btn ${shop.open ? 'btn-quiet' : 'btn-no'}`}
        disabled={busy}
        onClick={() => void toggleOpen()}
      >
        {shop.open ? t.shopOpen : t.shopClosed}
      </button>
      <details>
        <summary>{t.deliverySettings}</summary>
        <div className="stack">
          <DeliveryFields state={delivery} onChange={setDelivery} control="checkbox" />
          <button
            type="button"
            className="btn btn-yes"
            disabled={busy}
            onClick={() => void saveDelivery()}
          >
            {t.save}
          </button>
          <label className="field">
            <span>{t.deliveryLimitLabel}</span>
            <input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={limit}
              onChange={(event) => setLimit(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="btn btn-yes"
            disabled={busy}
            onClick={() => void saveLimit()}
          >
            {t.deliveryLimitSave}
          </button>
          {saved && <p role="status">{t.saved}</p>}
        </div>
      </details>
      {error && (
        <p className="alert" role="alert">
          {t.errSetOpen}
        </p>
      )}
    </div>
  );
}
