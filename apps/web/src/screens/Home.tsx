import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { ActiveOrderStrip } from '../components/ActiveOrderStrip.js';
import { ErrandResume } from '../components/ErrandResume.js';
import { FollowUpSheet, type FollowUp, type FollowUpOption } from '../components/FollowUpSheet.js';
import { LangToggle } from '../components/LangToggle.js';
import { LoginSheet } from '../components/LoginSheet.js';
import { ListEditor, lineTexts } from '../components/ListEditor.js';
import { PhotoPicker } from '../components/PhotoPicker.js';
import { BRAND_NAME } from '../brand.js';
import '../customer/find.css';
import '../customer/lists.css';
import { useT } from '../i18n/index.js';
import { ApiError } from '../lib/api.js';
import { clearDraft, loadDraft, saveDraft } from '../lib/draft.js';
import { resumableErrand } from '../lib/errand.js';
import type { ListView } from '../lib/listApi.js';
import {
  clearListDraft,
  editorRows,
  loadFindMode,
  loadListDraft,
  looksLikeSeveral,
  needsCheck,
  saveFindMode,
  saveListDraft,
  splitItems,
  type FindMode,
} from '../lib/lists.js';
import { isActiveOrder, type SeekerOrder } from '../lib/orders.js';
import type {
  ErrandListItem,
  NewRequest,
  SavedAddress,
  SeekerApi,
  SeekerRequest,
} from '../lib/seekerApi.js';
import { BottomSheet } from '../ui/BottomSheet.js';
import { Button } from '../ui/Button.js';
import { Field } from '../ui/Field.js';
import { BrandMark } from '../ui/BrandMark.js';
import { Icon } from '../ui/Icon.js';
import { SegmentedControl } from '../ui/SegmentedControl.js';
import { Skeleton } from '../ui/Skeleton.js';
import { Switch } from '../ui/Switch.js';

const MIN_ADDRESS = 5;

/** Indore, Rajwada: the demo works anywhere because the shops are simulated around here. */
const DEMO = { lat: 22.7196, lng: 75.8577 };

interface Props {
  api: SeekerApi;
  /** Whether the customer is signed in. Find opens for anyone; sending needs a login. */
  loggedIn: boolean;
  /** The customer logged in from the sheet here: the app stores the token. */
  onLoggedIn: (token: string) => void;
  onFound: (request: SeekerRequest, origin: { lat: number; lng: number }) => void;
  /** A list was sorted (to check) or sent: its screen has an address of its own. */
  onList: (list: ListView, origin: { lat: number; lng: number }) => void;
  /** Goes to another address of the customer app without a page load. */
  navigate: (path: string) => void;
}

/** A link that opens inside the app on a plain tap, and lets the browser handle ctrl/middle-click. */
export function appLink(navigate: (path: string) => void, path: string) {
  return {
    href: path,
    onClick(event: MouseEvent<HTMLAnchorElement>) {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
      event.preventDefault();
      navigate(path);
    },
  };
}

function coordinate(text: string, limit: number): number | null {
  if (text.trim() === '') return null;
  const value = Number(text);
  return Number.isFinite(value) && Math.abs(value) <= limit ? value : null;
}

const validOptions = (list: unknown): FollowUpOption[] =>
  Array.isArray(list)
    ? list.filter(
        (o): o is FollowUpOption =>
          typeof o?.itemId === 'string' &&
          typeof o?.nameEn === 'string' &&
          typeof o?.nameHi === 'string',
      )
    : [];

/** item_ambiguous: two or more items it might be, with the server's question (English, ADR-0048). */
function ambiguousFrom(error: ApiError): FollowUp | null {
  const options = validOptions(error.details['options']);
  const question = error.details['question'];
  return options.length >= 2
    ? { options, ...(typeof question === 'string' && question.trim() !== '' && { question }) }
    : null;
}

/** item_confirm: the item the server understood and the other items it might be. */
function confirmFrom(error: ApiError): FollowUp | null {
  const [understood] = validOptions([error.details['item']]);
  return understood
    ? { understood, options: validOptions(error.details['alternatives']).slice(0, 2) }
    : null;
}

interface SendOptions {
  q?: string;
  pick?: { itemId: string; understanding?: 'confirmed' | 'changed' };
  changed?: boolean;
  /** Search exactly these words (ADR-0045). */
  asTyped?: boolean;
}

/**
 * Find: one box, a place, optional delivery. Opens for anyone; pressing Find signed out opens the
 * login sheet and, once logged in, sends the draft by itself. The orders and the active-order strip
 * are best effort: if they cannot be fetched Find still works.
 */
export function Home({ api, loggedIn, onLoggedIn, onFound, onList, navigate }: Props) {
  const { t } = useT();
  const c = t.c;
  const draft = useRef(loadDraft()).current;
  const [query, setQuery] = useState(draft.query);
  const [mode, setMode] = useState<FindMode>(loadFindMode);
  const [rows, setRows] = useState<string[]>(() => editorRows(loadListDraft()));
  const [wantsDelivery, setWantsDelivery] = useState(draft.wantsDelivery);
  const [typedAddress, setTypedAddress] = useState(draft.address);
  const [lat, setLat] = useState(draft.lat);
  const [lng, setLng] = useState(draft.lng);
  const [photoId, setPhotoId] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedAddress | null>(null);
  /** The saved-address request has answered (or failed) at least once for this login. */
  const [savedLoaded, setSavedLoaded] = useState(false);
  const [changingAddress, setChangingAddress] = useState(false);
  const [orders, setOrders] = useState<SeekerOrder[]>([]);
  const [errand, setErrand] = useState<ErrandListItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [followUp, setFollowUp] = useState<FollowUp | null>(null);
  const [sheetError, setSheetError] = useState<string | null>(null);
  /** Find nearby is never disabled: pressing it too early says what is missing and goes there. */
  const [nudge, setNudge] = useState<'query' | 'address' | null>(null);
  const queryBox = useRef<HTMLInputElement>(null);
  const addressBox = useRef<HTMLTextAreaElement>(null);
  const followUpOpen = useRef(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [locationOpen, setLocationOpen] = useState(false);
  const [locationNote, setLocationNote] = useState<string | null>(null);
  const [online, setOnline] = useState(() => navigator.onLine !== false);
  /** Set by "Find nearby" or the photo button: whether the login should end in a send. */
  const sendAfterLogin = useRef(false);
  /** The header's Account icon was pressed signed out: after the login, go to Account. */
  const accountAfterLogin = useRef(false);
  const sending = useRef(false);
  /** The list went out and its draft is cleared: do not write it back while the screen closes. */
  const listSent = useRef(false);
  /** The request went out and the draft is cleared: do not write it back while the screen closes. */
  const sent = useRef(false);
  /** The customer chose "Something else": their next search is a change of what we understood. */
  const rewrote = useRef(false);

  const hasSaved = saved?.id != null && saved.addressText != null;
  const usingSaved = hasSaved && !changingAddress;
  /** Delivery is on and we do not yet know whether an address is kept: show no field to type in. */
  const checkingAddress = wantsDelivery && loggedIn && !savedLoaded;
  const addressOk =
    !wantsDelivery ||
    (!checkingAddress && (usingSaved || typedAddress.trim().length >= MIN_ADDRESS));
  const ready = query.trim() !== '' && addressOk;
  const listLines = lineTexts(rows);

  useEffect(() => {
    if (sent.current) return;
    saveDraft({ query, wantsDelivery, address: typedAddress, lat, lng });
  }, [query, wantsDelivery, typedAddress, lat, lng]);

  useEffect(() => {
    if (listSent.current) return;
    saveListDraft(rows);
  }, [rows]);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine !== false);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  // Signed in: the orders still moving (a dot on My orders, a strip at the bottom). Best effort.
  useEffect(() => {
    if (!loggedIn) {
      setOrders([]);
      return;
    }
    let alive = true;
    api.myOrders().then(
      (found) => alive && setOrders(found.filter(isActiveOrder)),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [api, loggedIn]);

  // Signed in: an errand still running (or a fresh plan) gets a way back. Best effort.
  useEffect(() => {
    if (!loggedIn) {
      setErrand(null);
      return;
    }
    let alive = true;
    api.myErrands().then(
      (found) => alive && setErrand(resumableErrand(found)),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [api, loggedIn]);

  // Delivery asked for: look for the address the customer kept. A failure just means they type one.
  // Until it answers no field is shown, so the field never appears and then vanishes while typing.
  useEffect(() => {
    if (!loggedIn) {
      setSavedLoaded(false);
      setSaved(null);
      return;
    }
    if (!wantsDelivery) return;
    let alive = true;
    api.savedAddress().then(
      (found) => {
        if (!alive) return;
        setSaved(found);
        setSavedLoaded(true);
      },
      () => alive && setSavedLoaded(true),
    );
    return () => {
      alive = false;
    };
  }, [api, wantsDelivery, loggedIn]);

  const newest = [...orders].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

  function useDemo() {
    setLat(String(DEMO.lat));
    setLng(String(DEMO.lng));
    setLocationNote(c.findDemoOk);
  }

  /** Asks the phone where it is. Null when it cannot say (no support, refused, timed out). */
  function locate(): Promise<{ lat: number; lng: number } | null> {
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        resolve(null);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 10_000 },
      );
    });
  }

  async function useMyLocation() {
    setLocationNote(c.findLocating);
    const found = await locate();
    if (found) {
      setLat(String(found.lat));
      setLng(String(found.lng));
      setLocationNote(c.findLocationOk);
    } else setLocationNote(c.findLocationFailed);
  }

  followUpOpen.current = followUp !== null;

  async function send(options: SendOptions = {}) {
    const q = (options.q ?? query).trim();
    if (q === '' || sending.current) return;
    if (wantsDelivery && !usingSaved && typedAddress.trim().length < MIN_ADDRESS) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    setSheetError(null);
    try {
      let latValue = coordinate(lat, 90);
      let lngValue = coordinate(lng, 180);
      if (latValue === null || lngValue === null) {
        const found = await locate();
        if (!found) {
          setLocationNote(c.findLocationFailed);
          setLocationOpen(true);
          setBusy(false);
          return;
        }
        latValue = found.lat;
        lngValue = found.lng;
        setLat(String(found.lat));
        setLng(String(found.lng));
      }
      const input: NewRequest = { q, lat: latValue, lng: lngValue };
      if (options.pick) input.itemId = options.pick.itemId;
      if (options.pick?.understanding) input.understanding = options.pick.understanding;
      else if (options.changed || (!options.pick && rewrote.current))
        input.understanding = 'changed';
      if (options.asTyped) {
        input.asTyped = true;
        input.understanding = 'changed';
      }
      if (photoId) input.photoId = photoId;
      if (wantsDelivery) {
        const addressId = usingSaved
          ? (saved?.id as string)
          : (await api.keepAddress({ addressText: typedAddress.trim() })).id;
        if (addressId) {
          input.wantsDelivery = true;
          input.deliveryAddressId = addressId;
        }
      }
      const request = await api.createRequest(input);
      rewrote.current = false;
      sent.current = true;
      clearDraft();
      onFound(request, { lat: latValue, lng: lngValue });
    } catch (e) {
      const asked =
        e instanceof ApiError && e.code === 'item_ambiguous'
          ? ambiguousFrom(e)
          : e instanceof ApiError && e.code === 'item_confirm'
            ? confirmFrom(e)
            : null;
      if (asked) setFollowUp(asked);
      else if (e instanceof ApiError && e.status === 401) {
        sendAfterLogin.current = true;
        setLoginOpen(true);
      } else {
        const message =
          e instanceof ApiError && e.code === 'item_unresolved'
            ? t.errUnresolved
            : e instanceof ApiError && e.code === 'item_blocked'
              ? t.errItemBlocked
              : e instanceof ApiError && e.code === 'item_unavailable'
                ? t.errItemUnavailable
                : e instanceof ApiError && e.code === 'new_item_limit'
                  ? t.errNewItemLimit(String(e.details['scope'] ?? 'day'))
                  : e instanceof ApiError && e.status === 403
                    ? t.errNotSeeker
                    : t.errGeneric;
        // With the question sheet open, the reason shows inside it: the customer is not dropped
        // back on Find, and can pick again or change the words.
        if (followUpOpen.current) setSheetError(message);
        else setError(message);
      }
      setBusy(false);
    } finally {
      sending.current = false;
    }
  }

  /** Sorts the list; a list that is all clear goes to the shops at once, otherwise the customer checks it first. */
  async function submitList() {
    const lines = lineTexts(rows);
    if (lines.length === 0 || sending.current) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    try {
      let latValue = coordinate(lat, 90);
      let lngValue = coordinate(lng, 180);
      if (latValue === null || lngValue === null) {
        const found = await locate();
        if (!found) {
          setLocationNote(c.findLocationFailed);
          setLocationOpen(true);
          setBusy(false);
          return;
        }
        latValue = found.lat;
        lngValue = found.lng;
        setLat(String(found.lat));
        setLng(String(found.lng));
      }
      const place = { lat: latValue, lng: lngValue };
      const sorted = await api.sortList(lines);
      const next = needsCheck(sorted) ? sorted : await api.sendList(sorted.id, place);
      if (next.state !== 'DRAFT') {
        listSent.current = true;
        clearListDraft();
      }
      onList(next, place);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        sendAfterLogin.current = true;
        setLoginOpen(true);
      } else {
        const code = e instanceof ApiError ? e.code : '';
        setError(
          code === 'line_too_long'
            ? c.listErrTooLong
            : code === 'too_many_lines'
              ? c.listErrTooMany
              : code === 'list_rate_limited' || (e instanceof ApiError && e.status === 429)
                ? c.listErrRate
                : c.listErrGeneric,
        );
      }
      setBusy(false);
    } finally {
      sending.current = false;
    }
  }

  function makeList() {
    setRows(editorRows(splitItems(query, { and: true })));
    changeMode('list');
  }

  function changeMode(next: FindMode) {
    setMode(next);
    saveFindMode(next);
    setError(null);
    setNudge(null);
  }

  function pressFind() {
    if (sending.current || busy) return;
    if (mode === 'list') {
      if (listLines.length === 0) return;
      if (!loggedIn) {
        sendAfterLogin.current = true;
        setLoginOpen(true);
        return;
      }
      void submitList();
      return;
    }
    if (query.trim() === '') {
      setNudge('query');
      queryBox.current?.focus();
      return;
    }
    if (!ready) {
      setNudge('address');
      addressBox.current?.focus();
      return;
    }
    setNudge(null);
    if (!loggedIn) {
      sendAfterLogin.current = true;
      setLoginOpen(true);
      return;
    }
    void send();
  }

  function loggedInFromSheet(token: string) {
    // The app stores the token first (the api reads it through the session), then the draft goes.
    onLoggedIn(token);
    setLoginOpen(false);
    if (accountAfterLogin.current) {
      accountAfterLogin.current = false;
      navigate('/app/account');
      return;
    }
    if (sendAfterLogin.current) {
      sendAfterLogin.current = false;
      void (mode === 'list' ? submitList() : send());
    }
  }

  const activeLabel = c.findActiveDot;

  return (
    <>
      <header className="cu-bar cu-find__bar">
        <span className="cu-find__brand">
          <BrandMark size={32} />
          <span className="cu-find__brandtext">
            <span className="cu-find__brand-name sh-heading">{BRAND_NAME}</span>
            <span className="cu-find__tagline">{c.findTagline}</span>
          </span>
        </span>
        <LangToggle />
        <a
          className="sh-icon-btn cu-find__orders"
          aria-label={c.findMyOrders}
          {...(newest && { 'aria-describedby': 'find-active' })}
          {...appLink(navigate, '/app/orders')}
        >
          <Icon name="orders" />
          {newest && <span className="cu-find__dot" aria-hidden="true" />}
        </a>
        {newest && (
          <span id="find-active" className="cu-find__sr">
            {activeLabel}
          </span>
        )}
        <a
          className="sh-icon-btn cu-find__orders"
          aria-label={c.accountOpen}
          {...(loggedIn
            ? appLink(navigate, '/app/account')
            : {
                href: '/app/account',
                onClick(event: MouseEvent<HTMLAnchorElement>) {
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0)
                    return;
                  event.preventDefault();
                  sendAfterLogin.current = false;
                  accountAfterLogin.current = true;
                  setLoginOpen(true);
                },
              })}
        >
          <Icon name="person" />
        </a>
      </header>

      <main className="cu-main cu-find">
        {!online && (
          <p className="sh-banner sh-banner--warn" role="status">
            {c.findOffline}
          </p>
        )}

        <form
          className="cu-find__form"
          onSubmit={(event) => {
            event.preventDefault();
            pressFind();
          }}
        >
          <button type="button" className="cu-find__chip" onClick={() => setLocationOpen(true)}>
            <Icon name="pin" size={18} />
            {c.findNearYou}
          </button>

          <h1 className="sh-title">{c.findTitle}</h1>

          <div className="cu-find__mode">
            <SegmentedControl
              label={c.findModeLabel}
              value={mode}
              onChange={changeMode}
              options={[
                { value: 'one', label: c.findModeOne },
                { value: 'list', label: c.findModeList },
              ]}
            />
          </div>

          {mode === 'list' ? (
            <>
              <ListEditor rows={rows} onChange={setRows} />
              <p className="sh-helper">{c.listModeNote}</p>
            </>
          ) : (
            <>
              <div className="cu-find__box">
                <input
                  type="text"
                  className="cu-find__input"
                  ref={queryBox}
                  aria-label={c.findTitle}
                  {...(nudge === 'query' && { 'aria-describedby': 'find-nudge' })}
                  autoComplete="off"
                  placeholder={c.findHint}
                  value={query}
                  onChange={(event) => {
                    sent.current = false;
                    setNudge(null);
                    setQuery(event.target.value);
                    setFollowUp(null);
                  }}
                />
                <div className="cu-find__box-foot">
                  {loggedIn ? (
                    <PhotoPicker api={api} role="request" onChange={setPhotoId} />
                  ) : (
                    <Button
                      variant="quiet"
                      onClick={() => {
                        sendAfterLogin.current = false;
                        setLoginOpen(true);
                      }}
                    >
                      <Icon name="photo" size={20} />
                      {c.findAddPhoto}
                    </Button>
                  )}
                </div>
              </div>

              <div className="cu-find__deliver">
                <Switch checked={wantsDelivery} onChange={setWantsDelivery} label={c.findDeliver} />
                <p className="sh-helper">{c.findDeliverHelp}</p>
              </div>
              {wantsDelivery &&
                (checkingAddress ? (
                  <div className="cu-find__saved" aria-busy="true">
                    <Skeleton height="48px" />
                  </div>
                ) : usingSaved ? (
                  <div className="cu-find__saved">
                    <p className="sh-body">{c.findDeliverTo(saved?.addressText as string)}</p>
                    <Button variant="quiet" onClick={() => setChangingAddress(true)}>
                      {c.findChangeAddress}
                    </Button>
                  </div>
                ) : (
                  <div className="cu-find__form">
                    <div className="sh-field">
                      <label htmlFor="find-address" className="sh-label">
                        {c.findAddressLabel}
                      </label>
                      <textarea
                        id="find-address"
                        ref={addressBox}
                        {...(nudge === 'address' && { 'aria-describedby': 'find-nudge' })}
                        className="cu-find__textarea"
                        rows={3}
                        maxLength={300}
                        autoComplete="street-address"
                        value={typedAddress}
                        onChange={(event) => {
                          setNudge(null);
                          setTypedAddress(event.target.value);
                        }}
                      />
                    </div>
                    <p className="sh-helper">{c.findAddressNote}</p>
                  </div>
                ))}

              {looksLikeSeveral(query) && (
                <Button variant="quiet" className="cu-find__makelist" onClick={makeList}>
                  {c.findMakeList}
                </Button>
              )}
            </>
          )}

          {nudge && (
            <p id="find-nudge" className="sh-helper" role="status">
              {nudge === 'query' ? c.findNeedQuery : c.findNeedAddress}
            </p>
          )}

          {error && (
            <p className="sh-alert" role="alert">
              {error}
            </p>
          )}

          {mode === 'list' ? (
            <Button
              type="submit"
              variant="primary"
              className="sh-btn--block"
              disabled={listLines.length === 0}
              aria-disabled={busy}
            >
              {busy ? c.listSorting : c.listFind(listLines.length)}
            </Button>
          ) : (
            <Button type="submit" variant="primary" className="sh-btn--block" aria-disabled={busy}>
              {busy ? c.findSubmitting : c.findSubmit}
            </Button>
          )}
        </form>

        {errand && <ErrandResume errand={errand} navigate={navigate} />}

        <a className="cu-find__errand" {...appLink(navigate, '/app/errand')}>
          <svg
            className="cu-find__errand-icon"
            viewBox="0 0 48 48"
            width="40"
            height="40"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M14 14V9M14 9h0M8 14h12a3 3 0 013 3v8a3 3 0 01-3 3H8a3 3 0 01-3-3v-8a3 3 0 013-3zM10.500 20h.01M17.500 20h.01M10 24h8" />
            <path d="M27 12h16v28H27zM31 19h8M31 25h8M31 31h5" />
          </svg>
          <span className="cu-find__errand-text">
            <span className="sh-heading">{c.findErrandTitle}</span>
            <span className="sh-helper">{c.findErrandText}</span>
          </span>
          <Icon name="right" size={20} className="cu-find__chevron" />
        </a>

        <a className="sh-btn sh-btn--quiet cu-find__shop" href="/app/shop">
          {c.findShopkeepers}
        </a>
      </main>

      {newest && <ActiveOrderStrip order={newest} navigate={navigate} />}

      <LoginSheet
        api={api}
        open={loginOpen}
        onClose={() => {
          sendAfterLogin.current = false;
          accountAfterLogin.current = false;
          setLoginOpen(false);
        }}
        onLoggedIn={loggedInFromSheet}
      />

      <FollowUpSheet
        key={followUp ? 'open' : 'closed'}
        followUp={followUp}
        busy={busy}
        typed={query.trim()}
        error={sheetError}
        onClose={() => {
          setFollowUp(null);
          setSheetError(null);
        }}
        onPick={(itemId, understanding) =>
          void send({ pick: { itemId, ...(understanding && { understanding }) } })
        }
        onAsTyped={(text, from) => {
          if (from === 'else') setQuery(text);
          void send({ q: text, asTyped: true });
        }}
      />

      <BottomSheet
        open={locationOpen}
        title={c.findLocationTitle}
        onClose={() => setLocationOpen(false)}
        footer={
          <Button variant="solid" className="sh-btn--block" onClick={() => setLocationOpen(false)}>
            {c.findDone}
          </Button>
        }
      >
        <div className="cu-find__form">
          <Button variant="secondary" onClick={() => void useMyLocation()}>
            <Icon name="pin" size={20} />
            {c.findUseMyLocation}
          </Button>
          <Button variant="secondary" onClick={useDemo}>
            {c.findUseDemo}
          </Button>
          {locationNote && (
            <p className="sh-label" role="status">
              {locationNote}
            </p>
          )}
          <fieldset className="cu-find__manual">
            <legend className="sh-label">{c.findManualTitle}</legend>
            <Field
              label={c.findLatitude}
              inputMode="decimal"
              value={lat}
              onChange={(event) => setLat(event.target.value)}
            />
            <Field
              label={c.findLongitude}
              inputMode="decimal"
              value={lng}
              onChange={(event) => setLng(event.target.value)}
            />
          </fieldset>
        </div>
      </BottomSheet>
    </>
  );
}
