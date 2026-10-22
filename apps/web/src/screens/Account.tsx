import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { OfflineBanner, appLink, useOnline } from '../customer/ordersShared.js';
import { ScreenBar } from '../customer/ScreenBar.js';
import '../customer/account.css';
import { useT } from '../i18n/index.js';
import { ApiError } from '../lib/api.js';
import {
  createPushClient,
  type DevicePushClient,
  type PushClient,
  type PushStatus,
} from '../lib/push.js';
import type { SavedAddress, SeekerApi } from '../lib/seekerApi.js';
import { readTheme, saveTheme, type Theme } from '../lib/theme.js';
import { BottomSheet } from '../ui/BottomSheet.js';
import { Button } from '../ui/Button.js';
import { Icon } from '../ui/Icon.js';
import { Skeleton } from '../ui/Skeleton.js';
import { Switch } from '../ui/Switch.js';

const MIN_ADDRESS = 5;

interface Props {
  api: Pick<
    SeekerApi,
    | 'account'
    | 'logout'
    | 'logoutAll'
    | 'deleteAccount'
    | 'savedAddress'
    | 'keepAddress'
    | 'pushConfig'
    | 'pushSubscribe'
    | 'pushUnsubscribe'
  >;
  /** Opens an /app/... path. */
  navigate: (path: string) => void;
  onBack: () => void;
  /** The login is over (logged out or deleted): the app forgets the token and shows Home. */
  onLoggedOut: () => void;
  /** For tests: a stand-in for the browser's push side. */
  pushClient?: DevicePushClient;
}

type Sheet = 'address' | 'see' | 'delete' | 'logoutAll' | null;

/**
 * The customer's Account (ADR-0054): who they are (the phone partly hidden), the address they kept,
 * reply alerts for this device, the look, what shops can see, log out and delete.
 */
export function Account({ api, navigate, onBack, onLoggedOut, pushClient }: Props) {
  const { t } = useT();
  const c = t.c;
  const online = useOnline();
  const [phone, setPhone] = useState<string | null | undefined>(undefined);
  const [address, setAddress] = useState<SavedAddress | null>(null);
  const [failed, setFailed] = useState(false);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [leaving, setLeaving] = useState(false);
  const alive = useRef(true);

  const push = useMemo(() => pushClient ?? createPushClient(api), [api, pushClient]);

  const load = useCallback(() => {
    setFailed(false);
    Promise.all([api.account(), api.savedAddress()]).then(
      ([account, saved]) => {
        if (!alive.current) return;
        setPhone(account.phoneMasked);
        setAddress(saved);
      },
      () => alive.current && setFailed(true),
    );
  }, [api]);

  useEffect(() => {
    alive.current = true;
    load();
    return () => {
      alive.current = false;
    };
  }, [load]);

  async function logOut() {
    setLeaving(true);
    // The login ends in the same call that drops this browser's alerts. If the server cannot be
    // reached, this device still forgets the login.
    const endpoint = await push.forgetDevice();
    await api.logout(endpoint).catch(() => undefined);
    onLoggedOut();
  }

  const hasAddress = address?.id != null && address.addressText != null;
  const loaded = phone !== undefined;

  return (
    <>
      <ScreenBar title={c.accountTitle} onBack={onBack} />
      <main className="cu-main cu-account">
        {!online && <OfflineBanner />}
        {failed ? (
          <div className="cu-account__error" role="alert">
            <p className="sh-body">{c.accountLoadFailed}</p>
            <Button variant="secondary" onClick={load}>
              {c.accountRetry}
            </Button>
          </div>
        ) : !loaded ? (
          <div className="cu-account__skeleton" aria-busy="true" aria-label={c.loading}>
            <Skeleton height="72px" radius="var(--r-md)" />
            <Skeleton height="96px" radius="var(--r-md)" />
            <Skeleton height="160px" radius="var(--r-md)" />
          </div>
        ) : (
          <>
            <section className="cu-account__card">
              <p className="sh-label sh-muted">{c.accountLoggedInAs}</p>
              <p className="sh-title cu-account__phone">{phone}</p>
            </section>

            <section className="cu-account__section" aria-labelledby="account-address">
              <h2 id="account-address" className="sh-caption">
                {c.accountAddressHeading}
              </h2>
              <div className="cu-account__card">
                <div className="cu-account__line">
                  <p className="sh-body cu-account__grow">
                    {hasAddress ? address?.addressText : c.accountNoAddress}
                  </p>
                  <Button variant="quiet" onClick={() => setSheet('address')}>
                    {hasAddress ? c.accountEditAddress : c.accountAddAddress}
                  </Button>
                </div>
                <p className="sh-helper">{c.accountAddressNote}</p>
              </div>
            </section>

            <section className="cu-account__section" aria-labelledby="account-settings">
              <h2 id="account-settings" className="sh-caption">
                {c.accountSettings}
              </h2>
              <div className="cu-account__card">
                <ReplyAlerts push={push} />
                <Appearance
                  value={theme}
                  onChange={(next) => {
                    saveTheme(next);
                    setTheme(next);
                  }}
                />
              </div>
            </section>

            <div className="cu-account__card cu-account__list">
              <a className="cu-account__row" {...appLink(navigate, '/app/orders')}>
                <span>{c.findMyOrders}</span>
                <Icon name="right" size={20} />
              </a>
              <button type="button" className="cu-account__row" onClick={() => setSheet('see')}>
                <span>{c.accountWhatShopsSee}</span>
                <Icon name="right" size={20} />
              </button>
            </div>

            <div className="cu-account__end">
              <Button
                variant="secondary"
                className="sh-btn--block cu-account__logout"
                disabled={leaving}
                onClick={() => void logOut()}
              >
                {c.accountLogout}
              </Button>
              <Button
                variant="quiet"
                className="cu-account__logout-all"
                disabled={leaving}
                onClick={() => setSheet('logoutAll')}
              >
                {c.accountLogoutAll}
              </Button>
              <Button
                variant="quiet"
                className="cu-account__delete"
                disabled={leaving}
                onClick={() => setSheet('delete')}
              >
                {c.accountDelete}
              </Button>
            </div>
          </>
        )}

        <p className="sh-helper cu-account__foot">
          {c.accountShopkeeper} <a href="/app/shop">{c.accountShopApp}</a>
        </p>
      </main>

      <AddressSheet
        open={sheet === 'address'}
        api={api}
        current={hasAddress ? (address as SavedAddress) : null}
        onClose={() => setSheet(null)}
        onSaved={(saved) => {
          setAddress(saved);
          setSheet(null);
        }}
      />

      <BottomSheet
        open={sheet === 'see'}
        title={c.accountWhatShopsSee}
        onClose={() => setSheet(null)}
      >
        <div className="cu-account__see">
          <p className="sh-body">{c.accountSeeIntro}</p>
          <p className="sh-body">{c.accountSeeNever}</p>
          <p className="sh-body">{c.accountSeeOrder}</p>
        </div>
      </BottomSheet>

      <LogoutAllSheet
        open={sheet === 'logoutAll'}
        onClose={() => setSheet(null)}
        onConfirm={async () => {
          // The server has already forgotten every device's alerts; this lets the browser forget its own.
          await api.logoutAll();
          await push.forgetDevice();
          onLoggedOut();
        }}
      />

      <DeleteSheet
        open={sheet === 'delete'}
        onClose={() => setSheet(null)}
        onDelete={async () => {
          await api.deleteAccount();
          // The server has already erased the alerts; this only lets the browser forget its own.
          await push.forgetDevice();
          onLoggedOut();
        }}
      />
    </>
  );
}

function ReplyAlerts({ push }: { push: PushClient }) {
  const { t } = useT();
  const c = t.c;
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    push.status().then(
      (next) => alive && setStatus(next),
      () => alive && setStatus('unsupported'),
    );
    return () => {
      alive = false;
    };
  }, [push]);

  async function change(on: boolean) {
    setBusy(true);
    setFailed(false);
    try {
      if (on) {
        const result = await push.enable();
        setFailed(result === 'failed');
        if (result === 'on' || result === 'blocked') setStatus(result);
      } else {
        await push.disable();
        setStatus('off');
      }
    } finally {
      setBusy(false);
    }
  }

  if (status === null) return <Skeleton height="48px" radius="var(--r-md)" />;

  const unavailable = status === 'unsupported' || status === 'disabled';
  const note =
    status === 'blocked'
      ? c.accountAlertsBlocked
      : unavailable
        ? c.accountAlertsUnavailable
        : status === 'ios_install'
          ? c.notifyIosHint
          : c.accountAlertsNote;

  return (
    <div className="cu-account__setting">
      <Switch
        label={c.accountAlerts}
        checked={status === 'on'}
        disabled={busy || unavailable || status === 'blocked' || status === 'ios_install'}
        onChange={(next) => void change(next)}
      />
      <p className="sh-helper">{note}</p>
      {failed && (
        <p className="sh-alert" role="alert">
          {c.notifyFailed}
        </p>
      )}
    </div>
  );
}

function Appearance({ value, onChange }: { value: Theme; onChange: (next: Theme) => void }) {
  const { t } = useT();
  const c = t.c;
  const options: { value: Theme; label: string }[] = [
    { value: 'system', label: c.accountThemeSystem },
    { value: 'light', label: c.accountThemeLight },
    { value: 'dark', label: c.accountThemeDark },
  ];
  return (
    <div className="cu-account__setting">
      <p className="sh-label" id="account-appearance">
        {c.accountAppearance}
      </p>
      <div className="cu-account__seg" role="radiogroup" aria-labelledby="account-appearance">
        {options.map((option) => (
          <label key={option.value} className="cu-account__seg-option">
            <input
              type="radio"
              name="account-theme"
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function AddressSheet({
  open,
  api,
  current,
  onClose,
  onSaved,
}: {
  open: boolean;
  api: Pick<SeekerApi, 'keepAddress'>;
  current: SavedAddress | null;
  onClose: () => void;
  onSaved: (saved: SavedAddress) => void;
}) {
  return open ? (
    <AddressForm api={api} current={current} onClose={onClose} onSaved={onSaved} />
  ) : null;
}

function AddressForm({
  api,
  current,
  onClose,
  onSaved,
}: {
  api: Pick<SeekerApi, 'keepAddress'>;
  current: SavedAddress | null;
  onClose: () => void;
  onSaved: (saved: SavedAddress) => void;
}) {
  const { t } = useT();
  const c = t.c;
  const [text, setText] = useState(current?.addressText ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    const addressText = text.trim();
    if (addressText.length < MIN_ADDRESS) {
      setError(c.accountAddressTooShort);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // The first name kept with an earlier order stays as it was.
      const saved = await api.keepAddress({
        addressText,
        ...(current?.customerName && { customerName: current.customerName }),
      });
      onSaved(saved);
    } catch {
      setError(c.accountAddressSaveFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet
      open
      title={current ? c.accountEditSheet : c.accountAddAddress}
      onClose={onClose}
      footer={
        <Button
          variant="solid"
          className="sh-btn--block"
          disabled={busy}
          onClick={() => void save()}
        >
          {c.accountAddressSave}
        </Button>
      }
    >
      <div className="cu-account__form">
        <label htmlFor="account-address-text" className="sh-label">
          {c.accountAddressLabel}
        </label>
        <textarea
          id="account-address-text"
          className="cu-account__textarea"
          rows={3}
          maxLength={300}
          autoComplete="street-address"
          value={text}
          onChange={(event) => {
            setError(null);
            setText(event.target.value);
          }}
        />
        <p className="sh-helper">{c.accountAddressNote}</p>
        {error && (
          <p className="sh-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </BottomSheet>
  );
}

function LogoutAllSheet({
  open,
  onClose,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  return open ? <LogoutAllConfirm onClose={onClose} onConfirm={onConfirm} /> : null;
}

/** Unlike a plain log out, this never pretends: if the server cannot be reached the login stays and it says so. */
function LogoutAllConfirm({
  onClose,
  onConfirm,
}: {
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const { t } = useT();
  const c = t.c;
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function confirm() {
    setBusy(true);
    setFailed(false);
    try {
      await onConfirm();
    } catch {
      setBusy(false);
      setFailed(true);
    }
  }

  return (
    <BottomSheet
      open
      title={c.accountLogoutAllTitle}
      onClose={onClose}
      footer={
        <div className="sh-sheet__confirm">
          <Button
            variant="danger"
            className="sh-btn--block"
            disabled={busy}
            onClick={() => void confirm()}
          >
            {c.accountLogoutAllConfirm}
          </Button>
          <Button variant="secondary" className="sh-btn--block" onClick={onClose}>
            {c.accountLogoutAllCancel}
          </Button>
        </div>
      }
    >
      <p className="sh-body">{c.accountLogoutAllBody}</p>
      {failed && (
        <p className="sh-alert" role="alert">
          {c.accountLogoutAllFailed}
        </p>
      )}
    </BottomSheet>
  );
}

function DeleteSheet({
  open,
  onClose,
  onDelete,
}: {
  open: boolean;
  onClose: () => void;
  onDelete: () => Promise<void>;
}) {
  return open ? <DeleteConfirm onClose={onClose} onDelete={onDelete} /> : null;
}

function DeleteConfirm({
  onClose,
  onDelete,
}: {
  onClose: () => void;
  onDelete: () => Promise<void>;
}) {
  const { t } = useT();
  const c = t.c;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await onDelete();
    } catch (e) {
      setBusy(false);
      setError(
        e instanceof ApiError && e.code === 'open_order'
          ? c.accountDeleteOpenOrder
          : e instanceof ApiError && e.status === 429
            ? c.accountDeleteTooMany
            : c.accountDeleteFailed,
      );
    }
  }

  return (
    <BottomSheet
      open
      title={c.accountDeleteTitle}
      onClose={onClose}
      footer={
        <div className="sh-sheet__confirm">
          <Button
            variant="danger"
            className="sh-btn--block"
            disabled={busy}
            onClick={() => void confirm()}
          >
            {c.accountDeleteConfirm}
          </Button>
          <Button variant="secondary" className="sh-btn--block" onClick={onClose}>
            {c.accountDeleteCancel}
          </Button>
        </div>
      }
    >
      <p className="sh-body">{c.accountDeleteBody}</p>
      {error && (
        <p className="sh-alert" role="alert">
          {error}
        </p>
      )}
    </BottomSheet>
  );
}
