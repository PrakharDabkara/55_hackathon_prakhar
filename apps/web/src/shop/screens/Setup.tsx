import type { Category } from '@askbuy/shared';
import { useRef, useState } from 'react';
import { useT } from '../../i18n/index.js';
import type { MyShop, ShopApi } from '../../lib/api.js';
import { blobToDataUrl, shrinkPhoto } from '../../lib/photo.js';
import type { LatLng } from '../lib/geo.js';
import { Button } from '../../ui/Button.js';
import { CategoryPicker } from '../ui/CategoryPicker.js';
import { Field } from '../../ui/Field.js';
import { Icon } from '../../ui/Icon.js';
import { checkDelivery, emptyDeliveryForm, type DeliveryForm } from '../lib/delivery.js';
import { DeliveryFields } from '../ui/DeliveryFields.js';
import { LocationPicker } from '../ui/LocationPicker.js';

interface Props {
  api: Pick<ShopApi, 'createShop' | 'uploadLogo' | 'updateShop'>;
  onDone: (shop: MyShop) => void;
  /** For tests: stand-ins for the phone's location and the canvas shrink. */
  locate?: () => Promise<LatLng | null>;
  prepareLogo?: (file: File) => Promise<Blob>;
}

/** Screen B, first login only: a name, what the shop sells, and where it is. Nothing else. */
export function Setup({ api, onDone, locate, prepareLogo = shrinkPhoto }: Props) {
  const { t } = useT();
  const s = t.shop;
  const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [categories, setCategories] = useState<Category[]>([]);
  const [place, setPlace] = useState<LatLng | null>(null);
  const [logo, setLogo] = useState<{ blob: Blob; preview: string } | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deliveryOpen, setDeliveryOpen] = useState(false);
  const [delivery, setDelivery] = useState<DeliveryForm>(emptyDeliveryForm);
  const [deliveryErrors, setDeliveryErrors] = useState<{ fee?: true; km?: true }>({});

  /** Everything the shop must still do before Start works, in the order of the screen. */
  const missing = [
    ...(name.trim() === '' ? [s.missingName] : []),
    ...(categories.length === 0 ? [s.missingCategory] : []),
    ...(place === null ? [s.missingLocation] : []),
  ];

  async function pickLogo(file: File | undefined) {
    if (!file) return;
    try {
      const blob = await prepareLogo(file);
      setLogo({ blob, preview: await blobToDataUrl(blob) });
    } catch {
      // The logo is optional: a picture that cannot be read is simply not added.
    }
  }

  async function start() {
    if (missing.length > 0 || place === null) return;
    const checked = checkDelivery(delivery);
    setDeliveryErrors(checked.ok ? {} : checked.errors);
    if (!checked.ok) {
      setDeliveryOpen(true);
      return;
    }
    setBusy(true);
    setFailed(false);
    try {
      let shop = await api.createShop({
        name: name.trim(),
        lat: place.lat,
        lng: place.lng,
        categories,
        ...(checked.delivery && { delivery: checked.delivery }),
      });
      if (checked.maxKm !== null) {
        // The shop exists now; a distance that fails to save can be set later in Delivery.
        try {
          shop = await api.updateShop({ deliveryMaxKm: checked.maxKm });
        } catch {
          // Keep going.
        }
      }
      if (logo) {
        // The shop exists now; a logo that fails to upload can be added later in Shop settings.
        try {
          shop = { ...shop, logoUrl: await api.uploadLogo(logo.blob) };
        } catch {
          // Keep going.
        }
      }
      onDone(shop);
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }

  return (
    <div className="sh-stack sh-setup">
      <header className="sh-stack">
        <h1 className="sh-title">{s.setupTitle}</h1>
        <p className="sh-body sh-muted">{s.setupHelper}</p>
      </header>

      <div className="sh-logopick">
        <input
          ref={input}
          type="file"
          accept="image/*"
          hidden
          tabIndex={-1}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            void pickLogo(file);
          }}
        />
        <button
          type="button"
          className="sh-logopick__circle"
          aria-label={s.logoCaption}
          onClick={() => input.current?.click()}
        >
          {logo ? (
            <img className="sh-logopick__img" src={logo.preview} alt="" />
          ) : (
            <Icon name="camera" size={32} />
          )}
          <span className="sh-logopick__plus" aria-hidden="true">
            <Icon name="plus" size={16} />
          </span>
        </button>
        <p className="sh-label sh-muted">{s.logoCaption}</p>
      </div>

      <Field
        label={s.shopName}
        autoComplete="organization"
        maxLength={80}
        required
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <CategoryPicker title={s.sellTitle} value={categories} onChange={setCategories} required />
      <LocationPicker value={place} onChange={setPlace} required {...(locate && { locate })} />

      <section className="sh-card sh-stack">
        <button
          type="button"
          className="sh-disclosure"
          aria-expanded={deliveryOpen}
          aria-controls="setup-delivery"
          onClick={() => setDeliveryOpen((open) => !open)}
        >
          <span>
            {s.iDeliver} · {s.optional}
          </span>
          <Icon name="chevron" />
        </button>
        {deliveryOpen && (
          <div id="setup-delivery" className="sh-stack">
            <DeliveryFields value={delivery} onChange={setDelivery} errors={deliveryErrors} />
          </div>
        )}
      </section>

      {failed && (
        <p className="sh-alert" role="alert">
          {s.createFailed}
        </p>
      )}
      {missing.length > 0 && (
        <div className="sh-missing sh-helper">
          <p>{s.missingHeading}</p>
          <ul>
            {missing.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}
      <Button
        variant="primary"
        className="sh-btn--block"
        disabled={missing.length > 0 || busy}
        onClick={() => void start()}
      >
        {s.startReceiving}
      </Button>
    </div>
  );
}
