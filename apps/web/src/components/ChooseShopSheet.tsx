import { formatQuantity } from '@askbuy/shared';
import { useEffect, useId, useRef, useState } from 'react';
import { useT } from '../i18n/index.js';
import { ApiError } from '../lib/api.js';
import { formatDistance } from '../lib/format.js';
import { formatRupees } from '../lib/money.js';
import { directionsUrl, itemLabel } from '../lib/results.js';
import type { SeekerApi, SeekerRequest, ShopResult } from '../lib/seekerApi.js';
import { BottomSheet } from '../ui/BottomSheet.js';
import { Button, LinkButton } from '../ui/Button.js';
import { Field } from '../ui/Field.js';
import { ShopLogo } from '../ui/ShopLogo.js';
import { Skeleton } from '../ui/Skeleton.js';
import '../customer/replies.css';

interface Props {
  api: Pick<SeekerApi, 'placeOrder' | 'savedAddress'>;
  request: SeekerRequest;
  shop: ShopResult;
  navigate: (path: string) => void;
  onClose: () => void;
  /** The customer is going to the shop: note it (the screen decides whether that counts). */
  onPickup: (shopId: string) => void;
  /** An order was placed: fetch the screen's orders again. */
  onOrdered: () => void;
}

const MIN_ADDRESS = 5;
const MAX_NOTE = 140;

/**
 * "Choose this shop" (ADR-0031, ADR-0035): get it delivered (cash on delivery, an address and an
 * optional note) or pick it up (the route, noted so Home can later ask "got it?"). The one primary
 * button of the screen lives here, in the footer.
 */
export function ChooseShopSheet({
  api,
  request,
  shop,
  navigate,
  onClose,
  onPickup,
  onOrdered,
}: Props) {
  const { t, lang } = useT();
  const offered = shop.delivery !== undefined;
  const [mode, setMode] = useState<'delivery' | 'pickup'>(
    offered && request.wantsDelivery ? 'delivery' : 'pickup',
  );
  /** The customer's kept address: undefined while it loads, null when there is none. */
  const [saved, setSaved] = useState<string | null | undefined>(undefined);
  /** Typing a different address, or the only way to give one. */
  const [custom, setCustom] = useState(false);
  const [address, setAddress] = useState('');
  const [remember, setRemember] = useState(false);
  const [note, setNote] = useState('');
  /** The address picked on Find is gone (forgotten): ask for one here. */
  const [addressLost, setAddressLost] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sending = useRef(false);
  const alive = useRef(true);
  const radioName = useId();

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (!offered) return;
    api.savedAddress().then(
      (found) => alive.current && setSaved(found.addressText),
      () => alive.current && setSaved(null),
    );
  }, [api, offered]);

  const fromFind = request.wantsDelivery === true && !addressLost;
  const hasDefault = fromFind || !!saved;
  const typing = custom || (!hasDefault && saved !== undefined);
  const loadingAddress = !fromFind && !custom && saved === undefined;
  const addressOk = !typing || address.trim().length >= MIN_ADDRESS;

  const item = itemLabel(request.item, lang) ?? t.c.itemFallback;
  const quantity = shop.quantity ? formatQuantity(shop.quantity) : null;
  const fee = shop.delivery?.feePaise ?? null;
  const price = shop.pricePaise;

  async function place() {
    if (sending.current || !addressOk || loadingAddress) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    const addressText = typing ? address.trim() : fromFind ? undefined : (saved ?? undefined);
    try {
      const order = await api.placeOrder({
        shopId: shop.shopId,
        requestId: request.id,
        ...(addressText && { addressText }),
        ...(note.trim() !== '' && { note: note.trim() }),
        ...(typing && remember && { saveAddress: true }),
      });
      onOrdered();
      navigate(`/app/order/${order.id}`);
      if (alive.current) onClose();
    } catch (e) {
      if (!alive.current) return;
      if (e instanceof ApiError && e.code === 'address_required') {
        setAddressLost(true);
        setCustom(true);
      } else {
        setError(
          e instanceof ApiError && e.code === 'shop_closed'
            ? t.c.orderErrClosed
            : t.c.orderErrGeneric,
        );
      }
    } finally {
      sending.current = false;
      if (alive.current) setBusy(false);
    }
  }

  const feeText = fee !== null && fee > 0 ? formatRupees(fee) : null;
  const totalLine =
    price === null
      ? t.c.payCash
      : fee === null && shop.delivery
        ? t.c.payCashPlusFee(formatRupees(price))
        : t.c.payCashTotal(formatRupees(price + (fee ?? 0)));

  const footer =
    mode === 'pickup' ? (
      <LinkButton
        variant="primary"
        className="sh-btn--block"
        external
        href={directionsUrl(shop.lat, shop.lng)}
        onClick={() => {
          onPickup(shop.shopId);
          onClose();
        }}
      >
        {t.c.showWay}
      </LinkButton>
    ) : (
      <Button
        variant="primary"
        className="sh-btn--block"
        disabled={busy || !addressOk || loadingAddress}
        onClick={() => void place()}
      >
        {busy ? t.c.placingOrder : t.c.placeOrder}
      </Button>
    );

  return (
    <BottomSheet open title={t.c.chooseTitle} onClose={onClose} footer={footer}>
      <form
        className="cu-sheet"
        onSubmit={(event) => {
          event.preventDefault();
          if (mode === 'delivery') void place();
        }}
      >
        <div className="cu-sheet__shop">
          <ShopLogo name={shop.name} logoUrl={shop.logoUrl ?? null} size={48} />
          <div className="cu-sheet__shopname">
            <p className="sh-heading">{shop.name}</p>
            <p className="sh-caption sh-muted">{formatDistance(shop.distanceM)}</p>
          </div>
        </div>
        <div className="cu-sheet__item">
          <span>{t.c.sheetItem(item, quantity)}</span>
          <strong>{price === null ? t.c.priceNotShared : formatRupees(price)}</strong>
        </div>

        <fieldset className="sh-radios">
          <legend className="sh-label">{t.c.modeLabel}</legend>
          {offered && (
            <label className="sh-radio cu-sheet__radio">
              <input
                type="radio"
                name={radioName}
                checked={mode === 'delivery'}
                onChange={() => setMode('delivery')}
              />
              <span>
                <span className="cu-sheet__radio-title">{t.c.getDelivered}</span>
                <span className="cu-sheet__radio-sub">
                  {t.c.deliverySub(feeText, fee === 0, shop.delivery?.minutes ?? null)}
                </span>
              </span>
            </label>
          )}
          <label className="sh-radio cu-sheet__radio">
            <input
              type="radio"
              name={radioName}
              checked={mode === 'pickup'}
              onChange={() => setMode('pickup')}
            />
            <span>
              <span className="cu-sheet__radio-title">{t.c.pickMeUp}</span>
              <span className="cu-sheet__radio-sub">
                {t.c.pickupSub(formatDistance(shop.distanceM))}
              </span>
            </span>
          </label>
        </fieldset>

        {mode === 'delivery' && (
          <div className="cu-sheet__delivery">
            {loadingAddress ? (
              <Skeleton height="48px" />
            ) : typing ? (
              <>
                <Field
                  label={t.c.addressLabel}
                  helper={t.c.addressHelp}
                  autoComplete="street-address"
                  maxLength={300}
                  value={address}
                  onChange={(event) => setAddress(event.target.value)}
                />
                <label className="cu-sheet__check">
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(event) => setRemember(event.target.checked)}
                  />
                  <span>{t.c.rememberAddress}</span>
                </label>
              </>
            ) : (
              <div className="cu-sheet__address">
                <div>
                  <p className="sh-label">{t.c.deliverTo}</p>
                  <p className="sh-body">{saved || t.c.savedAddressFallback}</p>
                </div>
                <Button variant="quiet" onClick={() => setCustom(true)}>
                  {t.c.changeAddress}
                </Button>
              </div>
            )}
            <Field
              label={`${t.c.noteLabel} · ${t.c.optional}`}
              helper={t.c.noteCount(note.length, MAX_NOTE)}
              maxLength={MAX_NOTE}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
            <p className="cu-sheet__total">{totalLine}</p>
            {error && (
              <p className="sh-alert" role="alert">
                {error}
              </p>
            )}
          </div>
        )}
      </form>
    </BottomSheet>
  );
}
