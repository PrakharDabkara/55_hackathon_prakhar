import { useEffect, useMemo, useRef, useState } from 'react';
import { PlanMap } from '../components/PlanMap.js';
import { ScreenBar } from '../customer/ScreenBar.js';
import { useT } from '../i18n/index.js';
import { ApiError } from '../lib/api.js';
import { stopsForMap } from '../lib/errand.js';
import { formatDistance } from '../lib/format.js';
import type { ListView, OrderListInput, OrderListResult } from '../lib/listApi.js';
import {
  alternativesFor,
  initialPlan,
  lineLabel,
  movePlanLine,
  setPlanMode,
  summarizePlan,
  type PlanChoice,
  type PlanGroup,
} from '../lib/lists.js';
import { formatRupees } from '../lib/money.js';
import type { Place } from '../lib/place.js';
import type { SeekerApi } from '../lib/seekerApi.js';
import { BottomSheet } from '../ui/BottomSheet.js';
import { Button } from '../ui/Button.js';
import { Field } from '../ui/Field.js';
import { Icon } from '../ui/Icon.js';
import { SegmentedControl } from '../ui/SegmentedControl.js';
import { ShopLogo } from '../ui/ShopLogo.js';
import { Skeleton } from '../ui/Skeleton.js';
import '../customer/errand.css';
import '../customer/lists.css';

interface Props {
  api: Pick<SeekerApi, 'orderList' | 'savedAddress'>;
  list: ListView;
  origin: Place | null;
  onBack: () => void;
  /** The orders were made (or the list was already ordered): the screen shows them now. */
  onOrdered: (result?: OrderListResult) => void;
}

const MIN_ADDRESS = 5;
const MAX_NOTE = 140;

type Saved = { addressText: string; customerName: string | null } | null | undefined;

/**
 * Your plan: the shops in route order, what each one gives and at what price, pick up or deliver
 * for each, and one button that orders from all of them (cash). A line can move to another shop
 * that has it; everything is worked out here from the answers (ADR-0055 rule 11).
 */
export function ListPlan({ api, list, origin, onBack, onOrdered }: Props) {
  const { t } = useT();
  const c = t.c;
  const [choice, setChoice] = useState<PlanChoice>(() => initialPlan(list));
  const [moving, setMoving] = useState<number | null>(null);
  /** The kept address: undefined until asked, null when there is none. */
  const [saved, setSaved] = useState<Saved>(undefined);
  const [typing, setTyping] = useState(false);
  const [address, setAddress] = useState('');
  const [remember, setRemember] = useState(false);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sending = useRef(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const summary = useMemo(() => summarizePlan(list, choice, origin), [list, choice, origin]);
  const delivering = summary.deliveryShops > 0;

  // The address matters only once a shop is set to Deliver. A failure just means the customer types one.
  useEffect(() => {
    if (!delivering || saved !== undefined) return;
    api.savedAddress().then(
      (found) => {
        if (!alive.current) return;
        setSaved(
          found.addressText
            ? { addressText: found.addressText, customerName: found.customerName }
            : null,
        );
        if (found.customerName) setName((current) => current || (found.customerName as string));
      },
      () => alive.current && setSaved(null),
    );
  }, [api, delivering, saved]);

  const typed = typing || saved === null;
  const loadingAddress = delivering && saved === undefined;
  const addressOk =
    !delivering || (!loadingAddress && (!typed || address.trim().length >= MIN_ADDRESS));
  const here = origin ?? { lat: list.lat ?? 0, lng: list.lng ?? 0 };
  const mapStops = useMemo(
    () =>
      stopsForMap(
        summary.groups.map((g) => ({
          shopId: g.shopId,
          label: g.answer.name,
          lat: g.answer.lat,
          lng: g.answer.lng,
        })),
      ),
    [summary.groups],
  );

  function fail(e: unknown) {
    const code = e instanceof ApiError ? e.code : '';
    setError(
      code === 'shop_closed'
        ? c.planErrClosed
        : code === 'cannot_deliver'
          ? c.planErrCannotDeliver
          : code === 'line_not_available'
            ? c.planErrNotAvailable
            : code === 'list_stopped'
              ? c.planErrStopped
              : code === 'address_required'
                ? c.planErrAddress
                : c.planErrGeneric,
    );
  }

  async function order() {
    if (sending.current || busy || !addressOk || summary.shops === 0) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    const body: OrderListInput = {
      assignments: summary.groups
        .flatMap((g) => g.lines.map((l) => ({ position: l.position, shopId: g.shopId })))
        .sort((a, b) => a.position - b.position),
      modes: Object.fromEntries(summary.groups.map((g) => [g.shopId, g.mode])),
      ...(delivering && typed && { addressText: address.trim() }),
      ...(delivering && typed && remember && { saveAddress: true }),
      ...(delivering && name.trim() !== '' && { customerName: name.trim() }),
      ...(delivering && note.trim() !== '' && { note: note.trim() }),
    };
    try {
      onOrdered(await api.orderList(list.id, body));
    } catch (e) {
      if (!alive.current) return;
      if (e instanceof ApiError && e.code === 'already_ordered') onOrdered();
      else fail(e);
    } finally {
      sending.current = false;
      if (alive.current) setBusy(false);
    }
  }

  const movingLine =
    moving === null ? null : (list.lines.find((l) => l.position === moving) ?? null);
  const movingTo =
    moving === null
      ? []
      : alternativesFor(list, moving).filter((o) => o.answer.shopId !== choice.assignments[moving]);
  const movingLabel =
    summary.groups.flatMap((g) => g.lines).find((l) => l.position === moving)?.label ??
    movingLine?.text ??
    '';

  function card(group: PlanGroup, index: number) {
    const { answer } = group;
    const fee = answer.deliveryFeePaise;
    return (
      <li key={group.shopId} aria-label={answer.name} className="cu-pshop">
        <div className="cu-pshop__head">
          <span className="cu-pshop__badge" aria-hidden="true">
            {group.mode === 'delivery' ? <Icon name="delivery" size={20} /> : index + 1}
          </span>
          <ShopLogo name={answer.name} logoUrl={answer.logoUrl} size={40} />
          <div className="cu-pshop__who">
            <p className="sh-heading">{answer.name}</p>
            <p className="cu-pshop__meta">
              <span>{formatDistance(answer.distanceM)}</span> ·{' '}
              <span>{c.planItemCount(group.lines.length)}</span>
            </p>
          </div>
        </div>
        <SegmentedControl
          label={c.planModeLabel(answer.name)}
          value={group.mode}
          onChange={(mode) => setChoice(setPlanMode(choice, list, group.shopId, mode))}
          options={[
            { value: 'pickup', label: c.planPickup },
            answer.canDeliver
              ? {
                  value: 'delivery',
                  label: c.planDeliver(
                    fee !== null && fee > 0 ? formatRupees(fee) : null,
                    fee === 0,
                  ),
                }
              : { value: 'delivery', label: c.planNoDeliver, disabled: true },
          ]}
        />
        <ul className="cu-plines">
          {group.lines.map((line) => {
            const others = alternativesFor(list, line.position).filter(
              (o) => o.answer.shopId !== group.shopId,
            );
            const inner = (
              <>
                <span className="cu-pline__name">{line.label}</span>
                <span className="cu-pline__price">{formatRupees(line.pricePaise)}</span>
                {others.length > 0 && <Icon name="right" size={20} className="cu-pline__hint" />}
              </>
            );
            return (
              <li key={line.position}>
                {others.length > 0 ? (
                  <button
                    type="button"
                    className="cu-pline"
                    onClick={() => setMoving(line.position)}
                  >
                    {inner}
                  </button>
                ) : (
                  <div className="cu-pline">{inner}</div>
                )}
              </li>
            );
          })}
        </ul>
      </li>
    );
  }

  return (
    <>
      <ScreenBar title={c.planTitle} onBack={onBack} />
      <main className="cu-main">
        <div className="cu-pstats" role="group" aria-label={c.planTotals}>
          <div className="cu-pstat">
            <span className="cu-pstat__value">{summary.shops}</span>
            <span className="cu-pstat__label">{c.planShops}</span>
          </div>
          <div className="cu-pstat">
            <span className="cu-pstat__value">{c.planOfTotal(summary.covered, summary.total)}</span>
            <span className="cu-pstat__label">{c.planItems}</span>
          </div>
          <div className="cu-pstat">
            <span className="cu-pstat__value">{formatRupees(summary.cashPaise)}</span>
            <span className="cu-pstat__label">{c.planCash}</span>
          </div>
        </div>
        {summary.unknownFeeCount > 0 && (
          <p className="sh-helper">{c.planFeeUnknown(summary.unknownFeeCount)}</p>
        )}

        {summary.shops > 0 && (
          <PlanMap
            origin={here}
            stops={mapStops}
            label={c.planMapLabel}
            youAreHere={c.youAreHere}
          />
        )}

        <ul className="cu-pshops">{summary.groups.map(card)}</ul>

        {summary.missing.length > 0 && (
          <section className="cu-pmissing" aria-labelledby="plan-missing">
            <h2 id="plan-missing" className="sh-heading">
              {c.planMissingTitle}
            </h2>
            <p className="sh-helper">{c.planMissingHelp}</p>
            <ul className="cu-plines">
              {summary.missing.map((position) => {
                const line = list.lines.find((l) => l.position === position);
                return (
                  <li key={position} className="cu-pline">
                    <span className="cu-pline__name">{line ? lineLabel(line) : ''}</span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {delivering && (
          <section className="cu-pdeliver" aria-labelledby="plan-delivery">
            <h2 id="plan-delivery" className="sh-heading">
              {c.planDeliveryHeading}
            </h2>
            {loadingAddress ? (
              <Skeleton height="48px" />
            ) : typed ? (
              <>
                <Field
                  label={c.addressLabel}
                  helper={c.addressHelp}
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
                  <span>{c.rememberAddress}</span>
                </label>
              </>
            ) : (
              <div className="cu-sheet__address">
                <div>
                  <p className="sh-label">{c.deliverTo}</p>
                  <p className="sh-body">{saved?.addressText}</p>
                </div>
                <Button variant="quiet" onClick={() => setTyping(true)}>
                  {c.changeAddress}
                </Button>
              </div>
            )}
            <Field
              label={t.orderNameLabel}
              maxLength={60}
              autoComplete="given-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <Field
              label={`${c.noteLabel} · ${c.optional}`}
              helper={c.noteCount(note.length, MAX_NOTE)}
              maxLength={MAX_NOTE}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </section>
        )}

        {error && (
          <p className="sh-alert" role="alert">
            {error}
          </p>
        )}
        <Button
          variant="primary"
          className="sh-btn--block"
          disabled={busy || !addressOk || summary.shops === 0}
          onClick={() => void order()}
        >
          {busy ? c.planOrdering : c.planOrder(summary.shops)}
        </Button>
        <p className="sh-helper">{c.planOrderNote}</p>
      </main>

      <BottomSheet
        open={moving !== null}
        title={c.planMoveTitle(movingLabel)}
        onClose={() => setMoving(null)}
      >
        <div className="cu-sheet-form">
          <p className="sh-helper">{c.planMoveHelp}</p>
          <ul className="cu-pmove">
            {movingTo.map(({ answer, pricePaise }) => (
              <li key={answer.shopId}>
                <button
                  type="button"
                  className="cu-pmove__option"
                  onClick={() => {
                    if (moving !== null)
                      setChoice(movePlanLine(choice, list, moving, answer.shopId));
                    setMoving(null);
                  }}
                >
                  <span>{answer.name}</span>
                  <span>{formatRupees(pricePaise)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </BottomSheet>
    </>
  );
}
