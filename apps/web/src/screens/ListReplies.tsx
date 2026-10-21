import { useState } from 'react';
import { StopAskingSheet } from '../components/StopAskingSheet.js';
import { useT } from '../i18n/index.js';
import { formatDistance } from '../lib/format.js';
import type { AnswerView, ListView } from '../lib/listApi.js';
import { lineLabel, sendableLines } from '../lib/lists.js';
import { formatRupees } from '../lib/money.js';
import type { SeekerApi } from '../lib/seekerApi.js';
import { Button } from '../ui/Button.js';
import { Icon } from '../ui/Icon.js';
import { Parchi } from '../ui/Parchi.js';
import { ShopLogo } from '../ui/ShopLogo.js';
import { Skeleton } from '../ui/Skeleton.js';
import '../customer/replies.css';
import '../customer/lists.css';

interface Props {
  api: Pick<SeekerApi, 'stopList'>;
  list: ListView;
  now: number;
  onMakePlan: () => void;
  /** The list was stopped: here is how it stands now. */
  onStopped: (list: ListView) => void;
}

/** Whole minutes of listening left, rounded up; null for less than a minute. */
function minutesLeft(expiresAt: string, now: number): number | null {
  const minutes = Math.ceil((Date.parse(expiresAt) - now) / 60_000);
  return minutes >= 1 ? minutes : null;
}

/**
 * The replies to a sent list: a small request card of what was asked, a live status line, the
 * shops' answers in the server's order (the first open, the rest one line each), what the answers
 * cover, and "Make my plan" (ADR-0055).
 */
export function ListReplies({ api, list, now, onMakePlan, onStopped }: Props) {
  const { t } = useT();
  const c = t.c;
  const [openIds, setOpenIds] = useState<Record<string, boolean>>({});
  const [touched, setTouched] = useState(false);
  const [asking, setAsking] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);

  const lines = sendableLines(list);
  const byPosition = new Map(list.lines.map((l) => [l.position, l]));
  const answered = c.listAnswered(list.shopsAnswered);
  const stopped = list.state === 'STOPPED';
  const status =
    list.state === 'OPEN'
      ? c.listStatusListening(answered, minutesLeft(list.expiresAt, now))
      : list.state === 'FULL'
        ? c.listStatusFull(answered)
        : stopped
          ? c.listStatusStopped(answered)
          : c.listStatusEnded(answered);

  const plan = list.plan;
  const placed = plan?.assignments.length ?? 0;
  const everyItem = lines.length > 0 && placed === lines.length;

  async function stop() {
    setStopping(true);
    setStopError(null);
    try {
      onStopped(await api.stopList(list.id));
      setAsking(false);
    } catch {
      setStopError(c.stopFailed);
    } finally {
      setStopping(false);
    }
  }

  const isOpen = (answer: AnswerView, index: number) =>
    openIds[answer.shopId] ?? (index === 0 && !touched);
  const toggle = (answer: AnswerView, index: number) => {
    setTouched(true);
    setOpenIds({ ...openIds, [answer.shopId]: !isOpen(answer, index) });
  };

  function card(answer: AnswerView, index: number) {
    const open = isOpen(answer, index);
    const fee = answer.deliveryFeePaise;
    const delivery = answer.canDeliver
      ? c.listDelivers(fee !== null && fee > 0 ? formatRupees(fee) : null, fee === 0)
      : c.listPickupOnly;
    const body = `answer-${answer.shopId}`;
    return (
      <li key={answer.shopId} aria-label={answer.name} className="cu-lanswer">
        <button
          type="button"
          className="cu-lanswer__head"
          aria-expanded={open}
          aria-controls={body}
          onClick={() => toggle(answer, index)}
        >
          <ShopLogo name={answer.name} logoUrl={answer.logoUrl} size={40} />
          <span className="cu-lanswer__who">
            <span className="sh-heading cu-lanswer__name">{answer.name}</span>
            <span className="cu-lanswer__meta">
              {formatDistance(answer.distanceM)} · {delivery}
            </span>
          </span>
          <span className="cu-lanswer__figures">
            <span className="cu-lanswer__count">
              {c.listHaveOf(answer.haveCount, answer.lines.length)}
            </span>
            <span className="cu-lanswer__total">{formatRupees(answer.totalPaise)}</span>
          </span>
          <Icon name="chevron" size={20} className="cu-lanswer__chevron" />
        </button>
        {open && (
          <ul id={body} className="cu-lanswer__lines">
            {answer.lines.map((line) => {
              const source = byPosition.get(line.position);
              const label = source ? lineLabel(source) : '';
              const kind = line.status === 'have' ? 'have' : line.status === 'no' ? 'no' : 'skip';
              return (
                <li key={line.position} className={`cu-lline cu-lline--${kind}`}>
                  <span className="cu-lline__mark" aria-hidden="true">
                    {kind === 'have' ? '✓' : kind === 'no' ? '✗' : '–'}
                  </span>
                  <span className="cu-lline__name">{label}</span>
                  {kind === 'have' && <span className="cu-sr">{c.listSrHave}</span>}
                  <span className="cu-lline__price">
                    {kind === 'have'
                      ? formatRupees(line.pricePaise ?? 0)
                      : kind === 'no'
                        ? c.listLineNo
                        : c.listLineNotSold}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </li>
    );
  }

  return (
    <>
      <main className="cu-main">
        <Parchi
          className="cu-parchi"
          band={
            <span className="sh-label cu-parchi__meta">
              {c.listSent(list.shopsAsked, lines.length)}
            </span>
          }
        >
          <div className="sh-parchi__ruled">
            {list.lines.map((line) => (
              <p key={line.position} className="sh-parchi__note">
                {line.text}
              </p>
            ))}
          </div>
        </Parchi>
        <p className="sh-body cu-status" role="status">
          {status}
        </p>

        <section className="cu-section" aria-labelledby="list-answers">
          <h2 id="list-answers" className="sh-heading">
            {c.listAnswersHeading}
          </h2>
          {list.answers.length > 0 ? (
            <ul className="cu-lanswers">{list.answers.map(card)}</ul>
          ) : list.listening ? (
            <div className="cu-empty">
              <p className="sh-heading">{c.listWaiting}</p>
              <div className="cu-stack" aria-hidden="true">
                <Skeleton height="64px" radius="var(--r-md)" />
                <Skeleton height="64px" radius="var(--r-md)" />
              </div>
            </div>
          ) : (
            <div className="cu-empty">
              <p className="sh-heading">{c.noneFoundTitle}</p>
              <p className="sh-body">{c.noneFoundHelp}</p>
            </div>
          )}
        </section>

        {list.binding && (
          <Button variant="quiet" onClick={() => setAsking(true)}>
            {c.stopAsking}
          </Button>
        )}

        <div className="cu-lfoot">
          {stopped ? (
            <p className="sh-helper">{c.listStoppedNote}</p>
          ) : (
            <>
              <p className="sh-body" role="status">
                {everyItem
                  ? c.listCoverFull(plan?.stops.length ?? 0, lines.length)
                  : c.listCoverPartial(placed, lines.length)}
              </p>
              <Button
                variant="primary"
                className="sh-btn--block"
                disabled={placed === 0}
                onClick={onMakePlan}
              >
                {c.listMakePlan}
              </Button>
            </>
          )}
        </div>
      </main>

      <StopAskingSheet
        open={asking}
        body={c.stopBodyList}
        busy={stopping}
        error={stopError}
        onConfirm={() => void stop()}
        onClose={() => setAsking(false)}
      />
    </>
  );
}
