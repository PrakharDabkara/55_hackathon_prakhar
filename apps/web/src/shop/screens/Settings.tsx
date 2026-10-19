import type { Category } from '@kahanmilega/shared';
import { useRef, useState } from 'react';
import { useT } from '../../i18n/index.js';
import type { MyShop, ShopApi, ShopPatch } from '../../lib/api.js';
import { shrinkPhoto } from '../../lib/photo.js';
import type { LatLng } from '../lib/geo.js';
import { Button } from '../../ui/Button.js';
import { CategoryPicker } from '../ui/CategoryPicker.js';
import { Field } from '../../ui/Field.js';
import { LocationPicker } from '../ui/LocationPicker.js';
import { ShopLogo } from '../../ui/ShopLogo.js';
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
        <div className="sh-logorow">
          <ShopLogo name={shop.name} logoUrl={shop.logoUrl} size={64} />
          <div className="sh-logorow__actions">
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
            <Button variant="secondary" disabled={logoBusy} onClick={() => input.current?.click()}>
              {s.changeLogo}
            </Button>
            {shop.logoUrl && (
              <Button variant="quiet" disabled={logoBusy} onClick={() => void removeLogo()}>
                {s.removeLogo}
              </Button>
            )}
          </div>
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
    </>
  );
}
