import { useState, type FormEvent } from 'react';
import { PhotoPicker } from '../components/PhotoPicker.js';
import { Words } from '../components/Words.js';
import { useT } from '../i18n/index.js';
import { ApiError } from '../lib/api.js';
import { rupeesToPaise } from '../lib/money.js';
import type { NewRequest, SeekerApi, SeekerRequest } from '../lib/seekerApi.js';

interface Choice {
  question: string;
  options: { itemId: string; nameEn: string; nameHi: string }[];
}

/** The server's question, if the error really carries one we can show. */
function choiceFrom(error: ApiError): Choice | null {
  const { question, options } = error.details;
  if (typeof question !== 'string' || question === '' || !Array.isArray(options)) return null;
  const valid = options.filter(
    (o): o is Choice['options'][number] =>
      typeof o?.itemId === 'string' &&
      typeof o?.nameEn === 'string' &&
      typeof o?.nameHi === 'string',
  );
  return valid.length >= 2 ? { question, options: valid } : null;
}

interface Props {
  api: SeekerApi;
  onFound: (request: SeekerRequest, origin: { lat: number; lng: number }) => void;
}

/** Indore, Rajwada: the demo works anywhere because the shops are simulated around here. */
const DEMO = { lat: 22.7196, lng: 75.8577 };

function coordinate(text: string, limit: number): number | null {
  if (text.trim() === '') return null;
  const value = Number(text);
  return Number.isFinite(value) && Math.abs(value) <= limit ? value : null;
}

/** One big box, an optional price seen elsewhere, and a place. Nothing else. */
export function Search({ api, onFound }: Props) {
  const { t } = useT();
  const [query, setQuery] = useState('');
  const [price, setPrice] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [how, setHow] = useState<'phone' | 'demo' | null>(null);
  const [showManual, setShowManual] = useState(false);
  const [locationFailed, setLocationFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [photoId, setPhotoId] = useState<string | null>(null);

  const latValue = coordinate(lat, 90);
  const lngValue = coordinate(lng, 180);
  const ready = query.trim() !== '' && latValue !== null && lngValue !== null;

  function useDemo() {
    setLat(String(DEMO.lat));
    setLng(String(DEMO.lng));
    setHow('demo');
    setLocationFailed(false);
  }

  function useMyLocation() {
    setLocationFailed(false);
    const fail = () => {
      setHow(null);
      setLocationFailed(true);
      setShowManual(true);
    };
    if (!navigator.geolocation) {
      fail();
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLat(String(position.coords.latitude));
        setLng(String(position.coords.longitude));
        setHow('phone');
      },
      fail,
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  async function submit(event: FormEvent | null, itemId?: string) {
    event?.preventDefault();
    if (!ready || latValue === null || lngValue === null) return;
    const input: NewRequest = { q: query.trim(), lat: latValue, lng: lngValue };
    if (itemId) input.itemId = itemId;
    if (photoId) input.photoId = photoId;
    if (price.trim() !== '') {
      const parsed = rupeesToPaise(price);
      if (!parsed.ok) {
        setError(t.badPrice);
        return;
      }
      input.targetPricePaise = parsed.paise;
    }
    setBusy(true);
    setError(null);
    setChoice(null);
    try {
      onFound(await api.createRequest(input), { lat: latValue, lng: lngValue });
    } catch (e) {
      const asked = e instanceof ApiError && e.code === 'item_ambiguous' ? choiceFrom(e) : null;
      if (asked) setChoice(asked);
      else if (e instanceof ApiError && e.code === 'item_unresolved') setError(t.errUnresolved);
      else if (e instanceof ApiError && e.code === 'item_blocked') setError(t.errItemBlocked);
      else if (e instanceof ApiError && e.code === 'item_unavailable')
        setError(t.errItemUnavailable);
      else if (e instanceof ApiError && e.code === 'new_item_limit')
        setError(t.errNewItemLimit(String(e.details['scope'] ?? 'day')));
      else if (e instanceof ApiError && e.status === 403) setError(t.errNotSeeker);
      else setError(t.errGeneric);
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={(event) => void submit(event)}>
      <label className="field field-big">
        <span className="query-label">{t.queryLabel}</span>
        <input
          type="text"
          className="query-input"
          autoComplete="off"
          placeholder={t.queryHint}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setChoice(null);
          }}
        />
      </label>

      <PhotoPicker api={api} role="request" onChange={setPhotoId} />

      <label className="field">
        <span>{t.seenLabel}</span>
        <input
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={price}
          onChange={(event) => setPrice(event.target.value)}
        />
      </label>

      <div className="actions">
        <button type="button" className="btn btn-quiet" onClick={useMyLocation}>
          {t.useMyLocation}
        </button>
        <button type="button" className="btn btn-quiet" onClick={useDemo}>
          {t.demoLocation}
        </button>
      </div>
      {how === 'phone' && <p role="status">{t.locationOk}</p>}
      {how === 'demo' && <p role="status">✓ {t.demoLocation}</p>}
      {locationFailed && <p role="status">{t.locationFailed}</p>}

      {showManual && (
        <fieldset className="manual">
          <legend>{t.manualTitle}</legend>
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
        </fieldset>
      )}

      {choice && (
        <section className="choice" aria-label={choice.question}>
          <p className="choice-question">{choice.question}</p>
          {choice.options.map((o) => (
            <button
              key={o.itemId}
              type="button"
              className="btn btn-no choice-option"
              disabled={busy}
              onClick={() => void submit(null, o.itemId)}
            >
              <Words label={{ main: o.nameHi, sub: o.nameEn }} />
            </button>
          ))}
        </section>
      )}

      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}

      <button type="submit" className="btn btn-yes" disabled={!ready || busy}>
        {busy ? t.searching : t.search}
      </button>
    </form>
  );
}
