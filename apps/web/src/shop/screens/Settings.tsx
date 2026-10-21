import type { Category } from '@askbuy/shared';
import { useRef, useState } from 'react';
import { useT } from '../../i18n/index.js';
import type { MyShop, ShopApi, ShopPatch } from '../../lib/api.js';
import { shrinkPhoto } from '../../lib/photo.js';
import type { LatLng } from '../lib/geo.js';
import { Button } from '../../ui/Button.js';
import { CategoryPicker } from '../ui/CategoryPicker.js';
import { Field } from '../../ui/Field.js';
import { LocationPicker } from '../ui/LocationPicker.js';
import { BottomSheet } from '../../ui/BottomSheet.js';
import { Icon } from '../../ui/Icon.js';
import { useToast } from '../../ui/Toast.js';

interface Props {
  api: Pick<ShopApi, 'updateShop' | 'uploadLogo' | 'deleteLogo'>;
  shop: MyShop;
  onSaved: (shop: MyShop) => void;
  /** For tests: stand-ins for the canvas shrink and the phone's location. */
  prepareLogo?: (file: File) => Promise<Blob>;
  locate?: () => Promise<LatLng | null>;
}

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x) => b.includes(x));

/** Screen I: the logo, the name, what the shop sells and where it is. */
export function Settings({ api, shop, onSaved, prepareLogo = shrinkPhoto, locate }: Props) {
  const { t } = useT();
  const s = t.shop;
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(shop.name);
  const [categories, setCategories] = useState<Category[]>(shop.categories);
  const [place, setPlace] = useState<LatLng | null>({ lat: shop.lat, lng: shop.lng });
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoError, setLogoError] = useState(false);
  const [askRemove, setAskRemove] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const moved = place !== null && (place.lat !== shop.lat || place.lng !== shop.lng);
  const changed = name.trim() !== shop.name || !sameSet(categories, shop.categories) || moved;

  async function changeLogo(file: File | undefined) {
    if (!file) return;
    setLogoBusy(true);
    setLogoError(false);
    try {
      const logoUrl = await api.uploadLogo(await prepareLogo(file));
      onSaved({ ...shop, logoUrl });
    } catch {
      setLogoError(true);
    } finally {
      setLogoBusy(false);
    }
  }

  async function removeLogo() {
    setAskRemove(false);
    setLogoBusy(true);
    try {
      await api.deleteLogo();
      onSaved({ ...shop, logoUrl: null });
      toast(s.logoRemoved);
    } catch {
      toast(s.sendFailed);
    } finally {
      setLogoBusy(false);
    }
  }

  async function save() {
    const error = name.trim() === '' ? s.needName : categories.length === 0 ? s.needCategory : null;
    setError(error);
    if (error) return;
    const patch: ShopPatch = {
      ...(name.trim() !== shop.name && { name: name.trim() }),
      ...(!sameSet(categories, shop.categories) && { categories }),
      ...(moved && place && { lat: place.lat, lng: place.lng }),
    };
    setBusy(true);
    try {
      onSaved(await api.updateShop(patch));
      toast(s.saved);
    } catch {
      toast(s.sendFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="sh-title">{s.settingsTitle}</h1>

      <section className="sh-card sh-stack" aria-labelledby="logo-title">
        <h2 id="logo-title" className="sh-heading">
          {s.logoTitle}
        </h2>
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
              void changeLogo(file);
            }}
          />
          <button
            type="button"
            className={`sh-logopick__circle${shop.logoUrl ? ' sh-logopick__circle--set' : ''}`}
            aria-label={s.changeLogo}
            disabled={logoBusy}
            onClick={() => input.current?.click()}
          >
            {shop.logoUrl ? (
              <img className="sh-logopick__img" src={shop.logoUrl} alt="" />
            ) : (
              <Icon name="camera" size={32} />
            )}
            <span className="sh-logopick__plus" aria-hidden="true">
              <Icon name="camera" size={16} />
            </span>
          </button>
          {shop.logoUrl && (
            <Button variant="quiet" disabled={logoBusy} onClick={() => setAskRemove(true)}>
              {s.removeLogo}
            </Button>
          )}
        </div>
        {logoError && (
          <p role="alert" className="sh-error">
            {s.logoFailed}
          </p>
        )}
      </section>

      <section className="sh-card sh-stack">
        <Field
          label={s.shopName}
          autoComplete="organization"
          maxLength={80}
          value={name}
          error={error === s.needName ? error : null}
          onChange={(event) => setName(event.target.value)}
        />
        <CategoryPicker title={s.categoriesTitle} value={categories} onChange={setCategories} />
        {error === s.needCategory && (
          <p role="alert" className="sh-error">
            {error}
          </p>
        )}
        <LocationPicker value={place} onChange={setPlace} {...(locate && { locate })} />
      </section>

      <Button
        variant="primary"
        className="sh-btn--block"
        disabled={!changed || busy}
        onClick={() => void save()}
      >
        {s.save}
      </Button>
      <BottomSheet
        open={askRemove}
        title={s.removeLogoTitle}
        onClose={() => setAskRemove(false)}
        footer={
          <>
            <Button variant="danger" onClick={() => void removeLogo()}>
              {s.removeLogoYes}
            </Button>
            <Button variant="quiet" onClick={() => setAskRemove(false)}>
              {s.keepLogo}
            </Button>
          </>
        }
      >
        <p className="sh-body">{s.removeLogoText}</p>
      </BottomSheet>
    </>
  );
}
