import { useEffect, useRef, useState } from 'react';
import { useT } from '../../i18n/index.js';
import {
  ApiError,
  type ListAnswerBody,
  type MyShop,
  type ShopListLine,
  type ShopListParchi,
} from '../../lib/api.js';
import { formatRupees } from '../../lib/money.js';
import { displayItemName, formatQuantity } from '../lib/format.js';
import {
  buildListAnswer,
  issuesFromError,
  listSummary,
  setLinePrice,
  startDraft,
  toggleLine,
  type ListIssues,
} from '../lib/listAnswer.js';
import { Button } from '../../ui/Button.js';
import { Parchi } from '../../ui/Parchi.js';
import { Stamp } from '../../ui/Stamp.js';
import { Switch } from '../../ui/Switch.js';
import { TickBox } from './TickBox.js';
import { TimeRing } from './TimeRing.js';

const clearLine = (issues: ListIssues, lineId: string): ListIssues => ({
  ...issues,
  lines: Object.fromEntries(Object.entries(issues.lines).filter(([id]) => id !== lineId)),
});

const clearFee = (issues: ListIssues): ListIssues => ({
  lines: issues.lines,
  ...(issues.form && { form: issues.form }),
});

interface Props {
  parchi: ShopListParchi;
  shop: Pick<MyShop, 'deliversDefault' | 'defaultFeePaise' | 'defaultMinutes'>;
  now: number;
  /** answered: the stamp has landed. closed: the customer no longer wants answers. */
  stamp?: 'answered' | 'closed' | null;
  /** Rejects when the answer could not be sent; the card says why and stays as it is. */
  onSubmit: (body: ListAnswerBody) => Promise<void>;
}

/**
 * A shopping list as one paper slip. The shop answers right on it: tick what it has, type a price
 * for each, say whether it can deliver, send. Nothing is sent until the button is tapped, and
 * every line is answered (an unticked line is "no"). Ticked lines are a promise (ADR-0055).
 */
export function ListSlip({ parchi, shop, now, stamp = null, onSubmit }: Props) {
  const { t } = useT();
  const s = t.shop;
  const [draft, setDraft] = useState(() => startDraft(parchi, shop));
  const [issues, setIssues] = useState<ListIssues>({ lines: {} });
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const ask = useRef<HTMLDivElement>(null);
  /** The line just ticked: its price field takes the focus when it appears. */
  const justTicked = useRef<string | null>(null);

  const summary = listSummary(parchi, draft);
  const locked = busy || stamp !== null;
  const category = parchi.lines.filter((line) => !line.other);
  const other = parchi.lines.filter((line) => line.other);
  const hasIssue = Object.keys(issues.lines).length > 0 || issues.fee !== undefined;

  // After a mistake is shown, the keyboard lands on the first field that needs fixing.
  useEffect(() => {
    if (hasIssue)
      root.current?.querySelector<HTMLInputElement>('input[aria-invalid="true"]')?.focus();
  }, [issues, hasIssue]);
  useEffect(() => {
    if (asking) ask.current?.focus();
  }, [asking]);

  async function submit(body: ListAnswerBody) {
    setBusy(true);
    setAsking(false);
    setIssues({ lines: {} });
    try {
      await onSubmit(body);
    } catch (error) {
      setIssues(issuesFromError(error instanceof ApiError ? error.code : 'failed', parchi, draft));
    } finally {
      setBusy(false);
    }
  }

  function send() {
    const result = buildListAnswer(parchi, draft);
    if (!result.ok) return setIssues(result.issues);
    setIssues({ lines: {} });
    if (result.none) return setAsking(true);
    void submit(result.body);
  }

  function tick(line: ShopListLine) {
    if (!draft.ticked[line.lineId]) justTicked.current = line.lineId;
    setDraft(toggleLine(draft, line));
    setIssues((all) => clearLine(all, line.lineId));
  }

  function row(line: ShopListLine) {
    const on = draft.ticked[line.lineId] === true;
    const issue = issues.lines[line.lineId];
    const quantity = formatQuantity(line.quantity);
    const errorId = `${parchi.id}-${line.lineId}-error`;
    return (
      <div key={line.lineId} className={`sh-lrow${on ? ' is-on' : ''}`}>
        <button
          type="button"
          role="checkbox"
          aria-checked={on}
          disabled={locked}
          className="sh-lrow__tick"
          onClick={() => tick(line)}
        >
          <TickBox on={on} />
          <span className="sh-lrow__text">
            <span className="sh-lrow__name">
              {displayItemName(line.name)}
              {quantity && <span className="sh-lrow__qty"> · {quantity}</span>}
            </span>
            {line.displayName && <span className="sh-lrow__sub">{line.displayName}</span>}
            {line.lastPricePaise !== null && (
              <span className="sh-lrow__sub">{s.lastTime(formatRupees(line.lastPricePaise))}</span>
            )}
          </span>
        </button>
        <div className="sh-lrow__side">
          {on ? (
            <>
              <span className="sh-amount">
                <span className="sh-amount__unit" aria-hidden="true">
                  ₹
                </span>
                <input
                  className="sh-amount__input"
                  inputMode="numeric"
                  autoComplete="off"
                  aria-label={s.priceFor(line.name)}
                  disabled={locked}
                  value={draft.prices[line.lineId] ?? ''}
                  {...(issue && { 'aria-invalid': true, 'aria-describedby': errorId })}
                  ref={(el) => {
                    if (el && justTicked.current === line.lineId) {
                      justTicked.current = null;
                      el.focus();
                    }
                  }}
                  onChange={(event) => {
                    setDraft(setLinePrice(draft, line.lineId, event.target.value));
                    if (issue) setIssues(clearLine(issues, line.lineId));
                  }}
                />
              </span>
              {issue && (
                <p id={errorId} role="alert" className="sh-lrow__error">
                  {issue === 'price_required' ? s.addPrice : s.wholeRupees}
                </p>
              )}
            </>
          ) : (
            <span className="sh-lrow__hint">{s.tickToAdd}</span>
          )}
        </div>
      </div>
    );
  }

  const band = (
    <>
      <span className="sh-lstamp">{s.listStamp(parchi.lines.length)}</span>
      <span className="sh-parchi__reply">
        <span className="sh-label">{s.replyIn}</span>
        <TimeRing startedAt={parchi.sentAt} expiresAt={parchi.expiresAt} now={now} />
      </span>
    </>
  );

  if (stamp === 'closed') {
    return (
      <Parchi band={band} className="sh-list">
        <p className="sh-parchi__item sh-list__closed">{s.listClosed}</p>
      </Parchi>
    );
  }

  const formMessage =
    issues.form === 'cannot_deliver'
      ? s.listTooFar
      : issues.form === 'invalid'
        ? s.listInvalid
        : issues.form === 'ping_closed'
          ? s.listClosed
          : issues.form === 'failed'
            ? s.sendFailed
            : null;

  return (
    <Parchi band={band} className="sh-list">
      <div ref={root} className="sh-list__inner">
        <div className="sh-parchi__meta">
          <span className="sh-caption sh-paper-muted">
            {t.bands[parchi.distanceBand as keyof typeof t.bands] ?? parchi.distanceBand}
          </span>
          <span className="sh-caption sh-paper-muted">{s.tickWhatYouHave}</span>
        </div>
        {parchi.wantsDelivery && <p className="sh-parchi__note">{s.wantsDeliveryList}</p>}
        <div className="sh-lrows" role="group" aria-label={s.orderLines}>
          {category.map(row)}
        </div>
        {other.length > 0 && (
          <div className="sh-lrows sh-lrows--other" data-group="other">
            <p className="sh-ldivider">{s.otherDivider}</p>
            {other.map(row)}
          </div>
        )}

        {parchi.canDeliver && (
          <>
            <hr className="sh-parchi__rule" />
            <div className="sh-ldeliver">
              <Switch
                checked={draft.delivers}
                disabled={locked}
                onChange={(delivers) => setDraft({ ...draft, delivers })}
                label={
                  <span className="sh-ldeliver__label">
                    {s.canDeliverList}
                    <span className="sh-lrow__sub">{s.oneFee}</span>
                  </span>
                }
              />
              {draft.delivers && (
                <div className="sh-ldeliver__fee">
                  <span className="sh-lrow__name" aria-hidden="true">
                    {s.deliveryFeeLabel}
                  </span>
                  <span className="sh-amount">
                    <span className="sh-amount__unit" aria-hidden="true">
                      ₹
                    </span>
                    <input
                      className="sh-amount__input"
                      inputMode="numeric"
                      autoComplete="off"
                      aria-label={s.deliveryFeeLabel}
                      disabled={locked}
                      value={draft.fee}
                      {...(issues.fee && {
                        'aria-invalid': true,
                        'aria-describedby': `${parchi.id}-fee-error`,
                      })}
                      onChange={(event) => {
                        setDraft({ ...draft, fee: event.target.value });
                        if (issues.fee) setIssues(clearFee(issues));
                      }}
                    />
                  </span>
                  {issues.fee && (
                    <p id={`${parchi.id}-fee-error`} role="alert" className="sh-lrow__error">
                      {s.feeWholeRupees}
                    </p>
                  )}
                </div>
              )}
            </div>
          </>
        )}

        <hr className="sh-parchi__rule" />
        <div className="sh-lsum">
          <span className="sh-parchi__note">{s.youHaveOf(summary.ticked, summary.of)}</span>
          <span className="sh-parchi__total" aria-label={s.total}>
            {formatRupees(summary.totalPaise)}
          </span>
        </div>

        <div className="sh-parchi__foot">
          {asking ? (
            <div
              ref={ask}
              role="alertdialog"
              aria-label={s.sendNoneTitle}
              tabIndex={-1}
              className="sh-lask"
            >
              <p className="sh-parchi__note">{s.sendNoneTitle}</p>
              <p className="sh-lrow__sub">{s.sendNoneBody}</p>
              <div className="sh-parchi__foot--two sh-lask__buttons">
                <Button variant="neutral" onClick={() => setAsking(false)}>
                  {s.goBack}
                </Button>
                <Button
                  variant="ink"
                  onClick={() => {
                    const result = buildListAnswer(parchi, draft);
                    if (result.ok) void submit(result.body);
                  }}
                >
                  {s.send}
                </Button>
              </div>
            </div>
          ) : (
            <>
              <Button variant="ink" className="sh-btn--block" disabled={locked} onClick={send}>
                {s.sendAnswer}
              </Button>
              <p className="sh-lrow__sub sh-lnote">{s.committedNote}</p>
            </>
          )}
          {formMessage && (
            <p role="alert" className="sh-lrow__error">
              {formMessage}
            </p>
          )}
        </div>
      </div>
      {stamp === 'answered' && (
        <span className="sh-parchi__stamp">
          <Stamp variant="yes" />
        </span>
      )}
    </Parchi>
  );
}
