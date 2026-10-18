import { CATEGORIES, type Category } from '@kahanmilega/shared';
import { useState, type FormEvent } from 'react';
import { DeliveryFields, deliveryFrom, type DeliveryState } from '../components/DeliveryFields.js';
import { Words } from '../components/Words.js';
import { useT } from '../i18n/index.js';
import type { MyShop, ShopApi } from '../lib/api.js';

interface Props {
  api: ShopApi;
  onDone: (shop: MyShop) => void;
}

const MAX_CATEGORIES = 3;

/** Indore, Rajwada: the same demo place as the customer app, where the simulated shops are. */
const DEMO = { lat: 22.7196, lng: 75.8577 };

/** A coordinate that is a number inside the allowed range, else null. */
function coordinate(text: string, limit: number): number | null {
  if (text.trim() === '') return null;
  const value = Number(text);
  return Number.isFinite(value) && Math.abs(value) <= limit ? value : null;
}

/**
 * Shown once, when the account has no shop yet: a name, one to three kinds of goods, a place.
 * The map pin arrives with Leaflet on Day 8; until then the phone's location or two typed numbers.
 */
export function Onboarding({ api, onDone }: Props) {
  const { t } = useT();
  const [name, setName] = useState('');
  const [categories, setCategories] = useState<Category[]>([]);
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [located, setLocated] = useState(false);
  const [demo, setDemo] = useState(false);
  const [delivery, setDelivery] = useState<DeliveryState>({ enabled: false, fee: '', minutes: '' });
  const [locationFailed, setLocationFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const latValue = coordinate(lat, 90);
  const lngValue = coordinate(lng, 180);
  const ready =
    name.trim() !== '' &&
    categories.length >= 1 &&
    categories.length <= MAX_CATEGORIES &&
    latValue !== null &&
    lngValue !== null;

  function toggle(category: Category) {
    setCategories((chosen) => {
      if (chosen.includes(category)) return chosen.filter((c) => c !== category);
      return chosen.length >= MAX_CATEGORIES ? chosen : [...chosen, category];
    });
  }

  function useDemo() {
    setLat(String(DEMO.lat));
    setLng(String(DEMO.lng));
    setLocated(true);
    setDemo(true);
    setLocationFailed(false);
  }

  function useMyLocation() {
    setDemo(false);
    setLocationFailed(false);
    if (!navigator.geolocation) {
      setLocationFailed(true);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLat(String(position.coords.latitude));
        setLng(String(position.coords.longitude));
        setLocated(true);
      },
      () => {
        setLocated(false);
        setLocationFailed(true);
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready || latValue === null || lngValue === null) return;
    setBusy(true);
    setError(null);
    try {
      const offer = deliveryFrom(delivery);
      if (!offer.ok) {
        setError(t.badPrice);
        setBusy(false);
        return;
      }
      onDone(
        await api.createShop({
          name: name.trim(),
          lat: latValue,
          lng: lngValue,
          categories,
          ...(offer.value && { delivery: offer.value }),
        }),
      );
    } catch {
      setError(t.errCreateShop);
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={(event) => void submit(event)}>
      <label className="field">
        <span>{t.shopNameLabel}</span>
        <input
          type="text"
          autoComplete="organization"
          maxLength={80}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>

      <fieldset className="tiles">
        <legend>{t.categoriesTitle}</legend>
        {CATEGORIES.map((category) => {
          const chosen = categories.includes(category);
          return (
            <button
              key={category}
              type="button"
              className="tile"
              aria-pressed={chosen}
              aria-disabled={!chosen && categories.length >= MAX_CATEGORIES}
              onClick={() => toggle(category)}
            >
              <Words label={t.categoryLabels[category]} />
            </button>
          );
        })}
      </fieldset>

      <DeliveryFields state={delivery} onChange={setDelivery} control="checkbox" />

      <div className="actions">
        <button type="button" className="btn btn-quiet" onClick={useMyLocation}>
          {t.useMyLocation}
        </button>
        <button type="button" className="btn btn-quiet" onClick={useDemo}>
          {t.demoLocation}
        </button>
      </div>
      {located && <p className="status">{demo ? `✓ ${t.demoLocation}` : t.locationOk}</p>}
      {locationFailed && (
        <p className="alert" role="alert">
          {t.locationFailed}
        </p>
      )}

      <details open={locationFailed}>
        <summary>{t.manualTitle}</summary>
        <div className="stack">
          <label className="field">
            <span>{t.latitude}</span>
            <input
              type="text"
              inputMode="decimal"
              value={lat}
              onChange={(e) => setLat(e.target.value)}
            />
          </label>
          <label className="field">
            <span>{t.longitude}</span>
            <input
              type="text"
              inputMode="decimal"
              value={lng}
              onChange={(e) => setLng(e.target.value)}
            />
          </label>
        </div>
      </details>

      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="btn btn-yes" disabled={!ready || busy}>
        {t.startShop}
      </button>
    </form>
  );
}
