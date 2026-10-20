import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { PhotoPicker } from '../components/PhotoPicker.js';
import { ScreenBar } from '../customer/ScreenBar.js';
import '../customer/errand.css';
import { useT } from '../i18n/index.js';
import { ApiError } from '../lib/api.js';
import { isFinalState, shownProgress } from '../lib/errand.js';
import { formatCountdown } from '../lib/format.js';
import type { LiveOptions } from '../lib/live.js';
import { rupeesToPaise } from '../lib/money.js';
import type { SeekerOrder } from '../lib/orders.js';
import type { PhotoApi } from '../lib/photoApi.js';
import type {
  ErrandAnswer,
  ErrandQuestion,
  ErrandView,
  NewErrand,
  SeekerApi,
} from '../lib/seekerApi.js';
import { useLive } from '../lib/useLive.js';
import { Button } from '../ui/Button.js';
import { Field } from '../ui/Field.js';
import { Icon } from '../ui/Icon.js';
import { Skeleton } from '../ui/Skeleton.js';
import { ErrandResult } from './ErrandResult.js';

/** Indore, Rajwada: the demo works anywhere because the shops are simulated around here. */
const DEMO = { lat: 22.7196, lng: 75.8577 };

interface Props {
  api: SeekerApi;
  onBack: () => void;
  /** The errand to show on arrival: a reload at /app/errand/<id> comes back to the same one. */
  errandId?: string | null | undefined;
  /** The errand on screen changed (a new id), or went back to the empty form (null). */
  onOpened?: ((id: string | null) => void) | undefined;
  navigate?: (path: string) => void;
  /** Fallback poll. Events do the real work; this only covers a stream that is down. */
  pollMs?: number;
  live?: Pick<LiveOptions, 'createSource' | 'retryMs'>;
}

type Texts = ReturnType<typeof useT>['t'];

/** The errand screen: describe the job, watch the agent work, confirm its list, read the plan. */
export function Errand({ api, onBack, errandId, onOpened, pollMs = 5000, live }: Props) {
  const [runId, setRunId] = useState<string | null>(errandId ?? null);

  function open(id: string | null) {
    setRunId(id);
    onOpened?.(id);
  }

  async function start(input: NewErrand) {
    const created = await api.createErrand(input);
    open(created.id);
  }

  return runId ? (
    <ErrandRun
      key={runId}
      api={api}
      id={runId}
      pollMs={pollMs}
      live={live}
      onBack={onBack}
      onRestart={start}
      onNew={() => open(null)}
    />
  ) : (
    <ErrandForm onStart={start} onBack={onBack} />
  );
}

function errorText(error: unknown, t: Texts): string {
  if (error instanceof ApiError) {
    if (error.code === 'task_rejected') return t.c.errandRejected;
    if (error.code === 'errand_rate_limited' || error.status === 429) return t.c.errandLimit;
    if (error.status === 403) return t.c.errandNotSeeker;
  }
  return t.c.errandGeneric;
}

function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine !== false);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return online;
}

function ErrandForm({
  onStart,
  onBack,
}: {
  onStart: (input: NewErrand) => Promise<void>;
  onBack: () => void;
}) {
  const { t } = useT();
  const c = t.c;
  const online = useOnline();
  const taskId = useId();
  const [task, setTask] = useState('');
  const [budget, setBudget] = useState('');
  const [where, setWhere] = useState<{ lat: number; lng: number } | null>(null);
  const [how, setHow] = useState<'phone' | 'demo' | null>(null);
  const [locationFailed, setLocationFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const ready = task.trim() !== '' && where !== null;

  function useMyLocation() {
    setLocationFailed(false);
    const fail = () => {
      setHow(null);
      setLocationFailed(true);
    };
    if (!navigator.geolocation) return fail();
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setWhere({ lat: p.coords.latitude, lng: p.coords.longitude });
        setHow('phone');
      },
      fail,
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready || !where) return;
    const input: NewErrand = { task: task.trim(), lat: where.lat, lng: where.lng };
    if (budget.trim() !== '') {
      const parsed = rupeesToPaise(budget);
      if (!parsed.ok) return setError(c.errandBadBudget);
      input.budgetPaise = parsed.paise;
    }
    setBusy(true);
    setError(null);
    try {
      await onStart(input);
    } catch (e) {
      if (!alive.current) return;
      setError(errorText(e, t));
      setBusy(false);
    }
  }

  return (
    <>
      <ScreenBar title={c.errandTitle} onBack={onBack} />
      <form className="cu-main" onSubmit={(event) => void submit(event)}>
        {!online && (
          <p className="sh-banner sh-banner--warn" role="status">
            {c.offline}
          </p>
        )}
        <div className="sh-field">
          <label htmlFor={taskId} className="sh-label">
            {c.errandJobLabel}
          </label>
          <textarea
            id={taskId}
            className="cu-errand-text"
            rows={4}
            maxLength={500}
            value={task}
            onChange={(e) => setTask(e.target.value)}
          />
        </div>
        <div className="cu-section">
          <p className="sh-caption">{c.errandExamplesTitle}</p>
          <div className="sh-chips">
            {t.errandExamples.map((example) => (
              <button
                key={example}
                type="button"
                className="sh-chip"
                onClick={() => setTask(example)}
              >
                {example}
              </button>
            ))}
          </div>
        </div>
        <Field
          label={c.errandBudgetLabel}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={budget}
          onChange={(e) => setBudget(e.target.value)}
        />
        <div className="cu-section">
          <div className="cu-errand-actions">
            <Button onClick={useMyLocation}>{c.errandUseLocation}</Button>
            <Button
              variant="quiet"
              onClick={() => {
                setWhere(DEMO);
                setHow('demo');
                setLocationFailed(false);
              }}
            >
              {c.errandDemoLocation}
            </Button>
          </div>
          {how === 'phone' && (
            <p className="cu-errand-status" role="status">
              {c.errandLocationOk}
            </p>
          )}
          {how === 'demo' && (
            <p className="cu-errand-status" role="status">
              {c.errandDemoOk}
            </p>
          )}
          {locationFailed && (
            <p className="cu-errand-status" role="status">
              {c.errandLocationFailed}
            </p>
          )}
        </div>
        {error && (
          <p className="sh-alert" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" disabled={!ready || busy || !online}>
          {busy ? c.errandMakingList : c.errandMakeList}
        </Button>
      </form>
    </>
  );
}

interface RunProps {
  api: SeekerApi;
  id: string;
  pollMs: number;
  live: Props['live'] | undefined;
  onBack: () => void;
  /** A new errand with this errand's task and place. */
  onRestart: (input: NewErrand) => Promise<void>;
  onNew: () => void;
}

/** One errand in flight: refetched on every server hint, and on a slow poll as a fallback. */
function ErrandRun({ api, id, pollMs, live, onBack, onRestart, onNew }: RunProps) {
  const { t } = useT();
  const c = t.c;
  const online = useOnline();
  const [view, setView] = useState<ErrandView | null>(null);
  const [orders, setOrders] = useState<SeekerOrder[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const alive = useRef(true);
  const finished = useRef(false);
  const lat = view?.lat ?? 0;
  const lng = view?.lng ?? 0;
  const origin = useMemo(() => ({ lat, lng }), [lat, lng]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const show = useCallback((next: ErrandView) => {
    if (!alive.current) return;
    finished.current = isFinalState(next.state);
    setLoadFailed(false);
    setView(next);
  }, []);
  // Delivery orders from this plan. An extra: if they cannot be fetched the plan still shows.
  const loadOrders = useCallback(() => {
    api.listOrders({ errandId: id }).then(
      (next) => {
        if (alive.current) setOrders(next);
      },
      () => undefined,
    );
  }, [api, id]);
  const refresh = useCallback(
    (type?: unknown) => {
      loadOrders();
      // A finished plan is not polled, but an order that moved (or a shop put back on pickup) is
      // news about it: those events fetch it again.
      if (finished.current && type !== 'order.updated' && type !== 'errand.updated') return;
      api
        .getErrand(id)
        .then(show)
        .catch((e: unknown) => {
          if (!alive.current) return;
          // An old or foreign link: say so once, instead of waiting for ever.
          if (e instanceof ApiError && e.status === 404) setGone(true);
          else setLoadFailed(true);
        });
    },
    [api, id, show, loadOrders],
  );
  useEffect(() => refresh(), [refresh]);
  const getTicket = useCallback(() => api.eventTicket(), [api]);
  useLive({ getTicket, refresh, pollMs, live });

  async function act(work: () => Promise<ErrandView>) {
    setBusy(true);
    setError(null);
    try {
      show(await work());
      refresh();
    } catch {
      if (alive.current) setError(c.errandGeneric);
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  /** A new errand with the same words, place and budget (a failed one, or one nobody answered). */
  async function again() {
    if (!view) return;
    setBusy(true);
    setError(null);
    try {
      await onRestart({
        task: view.task,
        lat: view.lat,
        lng: view.lng,
        ...(view.budgetPaise !== null && { budgetPaise: view.budgetPaise }),
      });
    } catch (e) {
      if (alive.current) {
        setError(errorText(e, t));
        setBusy(false);
      }
    }
  }

  const bar = <ScreenBar title={c.errandTitle} onBack={onBack} />;
  const offline = !online && (
    <p className="sh-banner sh-banner--warn" role="status">
      {c.offline}
    </p>
  );

  if (gone)
    return (
      <>
        {bar}
        <main className="cu-main">
          <p className="sh-alert">{c.errandGone}</p>
          <Button variant="quiet" onClick={onNew}>
            {c.errandNew}
          </Button>
        </main>
      </>
    );

  if (!view)
    return (
      <>
        {bar}
        <main className="cu-main" aria-busy={!loadFailed}>
          {offline}
          {loadFailed ? (
            <div className="cu-stack">
              <p className="sh-alert" role="alert">
                {c.errandLoadFailed} {c.loadFailedHelp}
              </p>
              <Button onClick={() => refresh()}>{c.retry}</Button>
            </div>
          ) : (
            <div className="cu-stack" role="status" aria-label={c.loading}>
              <Skeleton height="28px" width="70%" />
              <Skeleton height="72px" />
              <Skeleton height="72px" />
            </div>
          )}
        </main>
      </>
    );

  const lines = shownProgress(view.progress);
  const active =
    view.state === 'PLANNING' || view.state === 'WAITING_FOR_SHOPS' || view.state === 'NEEDS_INPUT';
  const elapsed = formatCountdown(Math.max(0, now - new Date(view.createdAt).getTime()));
  const ready = view.state === 'PLAN_READY' && view.plan?.plans;
  const partial = (view.state === 'FAILED' || view.state === 'EXPIRED') && view.plan?.plans;

  const timeline = (
    <ol className="cu-errand-progress" aria-label={c.errandProgressTitle}>
      {lines.map((line, i) => (
        <li key={`${i}-${line}`}>{line}</li>
      ))}
      {active && view.state !== 'NEEDS_INPUT' && (
        <li aria-hidden="true">
          <Skeleton height="20px" width="60%" />
        </li>
      )}
    </ol>
  );

  return (
    <>
      {bar}
      <main className="cu-main" aria-live="polite">
        {offline}
        <header className="cu-errand-head">
          <h2 className="sh-title cu-errand-task">{view.task}</h2>
          <span className={`cu-pill${ready ? '' : ' cu-pill--muted'}`}>
            {c.errandState(view.state)}
          </span>
        </header>

        {view.state === 'WAITING_FOR_SHOPS' && (
          <div className="cu-surface" role="status">
            <p className="sh-body">{c.errandWaiting}</p>
            <p className="cu-errand-status">{c.errandElapsed(elapsed)}</p>
          </div>
        )}

        {view.state === 'NEEDS_INPUT' && view.question && (
          <QuestionBox
            key={`${view.question.question}|${view.question.options?.join('|') ?? ''}`}
            question={view.question}
            photos={api}
            errandId={id}
            busy={busy}
            onAnswer={(answer) => void act(() => api.answerErrand(id, answer))}
          />
        )}

        {ready && view.plan ? (
          <>
            <ErrandResult
              plan={view.plan}
              photos={api}
              onMode={(shopId, mode) => void act(() => api.setDeliveryMode(id, shopId, mode))}
              orderApi={api}
              errandId={id}
              pickupApi={api}
              orders={orders}
              onOrderChange={() => {
                loadOrders();
                refresh();
              }}
              origin={origin}
              busy={busy}
              onAskAgain={() => void again()}
            />
            <details className="cu-errand-details">
              <summary>{c.errandProgressTitle}</summary>
              {timeline}
            </details>
            {view.lateAnswers.length > 0 && (
              <details className="cu-errand-details">
                <summary>{c.errandLateTitle(view.lateAnswers.length)}</summary>
                <ul>
                  {view.lateAnswers.map((line, i) => (
                    <li key={`${i}-${line}`}>{line}</li>
                  ))}
                </ul>
              </details>
            )}
          </>
        ) : (
          <>
            {(lines.length > 0 || active) && view.state !== 'NEEDS_INPUT' && timeline}
            {view.state === 'NEEDS_INPUT' && lines.length > 0 && timeline}
          </>
        )}

        {view.state === 'FAILED' && (
          <p className="sh-alert" role="alert">
            {c.errandFailed}{' '}
            {view.failureReason === 'ai_unavailable' ? c.errandFailedAi : c.errandGeneric}
          </p>
        )}
        {view.state === 'EXPIRED' && <p className="sh-alert">{c.errandExpired}</p>}
        {view.state === 'CANCELLED' && <p className="sh-alert">{c.errandCancelled}</p>}
        {partial && view.plan && (
          <>
            <p className="cu-errand-status">{c.errandPartial}</p>
            <ErrandResult
              plan={view.plan}
              photos={api}
              origin={origin}
              pickupApi={api}
              errandId={id}
            />
          </>
        )}
        {error && (
          <p className="sh-alert" role="alert">
            {error}
          </p>
        )}
        {loadFailed && (
          <div className="cu-stack">
            <p className="sh-alert" role="alert">
              {c.errandLoadFailed} {c.loadFailedHelp}
            </p>
            <Button onClick={() => refresh()}>{c.retry}</Button>
          </div>
        )}

        {active && (
          <Button
            variant="quiet"
            disabled={busy}
            onClick={() => void act(() => api.cancelErrand(id))}
          >
            {c.errandCancel}
          </Button>
        )}
        {view.state === 'FAILED' && (
          <Button
            variant={partial ? 'secondary' : 'primary'}
            disabled={busy}
            onClick={() => void again()}
          >
            {c.retry}
          </Button>
        )}
        {!active && (
          <Button variant="quiet" onClick={onNew}>
            {c.errandNew}
          </Button>
        )}
      </main>
    </>
  );
}

function QuestionBox({
  question,
  photos,
  errandId,
  busy,
  onAnswer,
}: {
  question: ErrandQuestion;
  photos: PhotoApi;
  errandId: string;
  busy: boolean;
  onAnswer: (answer: ErrandAnswer) => void;
}) {
  const { t } = useT();
  const c = t.c;
  const headingId = useId();
  const [text, setText] = useState('');
  const [adding, setAdding] = useState(false);
  const [ticked, setTicked] = useState<Set<number>>(() => new Set(question.preselected ?? []));
  const options = question.options ?? [];
  const list = question.multiSelect === true && options.length > 0;

  if (list) {
    const extra = text.trim();
    const count = ticked.size + (extra !== '' ? 1 : 0);
    const suggested = new Set(question.preselected ?? []);
    return (
      <form
        className="cu-surface"
        role="group"
        aria-labelledby={headingId}
        onSubmit={(event) => {
          event.preventDefault();
          if (count === 0) return;
          onAnswer({
            selected: [...ticked].sort((a, b) => a - b),
            ...(extra !== '' && { text: extra }),
          });
        }}
      >
        {/* The model's own question is data, never shown: the app names the list itself. */}
        <h2 id={headingId} className="sh-heading">
          {c.listTitle}
        </h2>
        <div className="cu-errand-ai">
          <Icon name="robot" size={20} />
          <p>{c.listAiNote}</p>
        </div>
        <ul className="cu-errand-rows">
          {options.map((option, i) => (
            <li
              key={option}
              className={`cu-errand-row${ticked.has(i) ? '' : ' cu-errand-row--off'}`}
            >
              <label className="cu-errand-row__label">
                <input
                  type="checkbox"
                  checked={ticked.has(i)}
                  disabled={busy}
                  {...(suggested.has(i) && { 'aria-describedby': `${headingId}-s${i}` })}
                  onChange={(e) =>
                    setTicked((current) => {
                      const next = new Set(current);
                      if (e.target.checked) next.add(i);
                      else next.delete(i);
                      return next;
                    })
                  }
                />
                <span className="cu-errand-row__name">{option}</span>
              </label>
              {suggested.has(i) && (
                <span id={`${headingId}-s${i}`} className="cu-errand-tag">
                  {c.listSuggested}
                </span>
              )}
              <div className="cu-errand-row__photo">
                <PhotoPicker
                  api={photos}
                  role="request"
                  label={option}
                  errand={{ id: errandId, label: option }}
                  onChange={() => undefined}
                />
              </div>
            </li>
          ))}
        </ul>
        {adding ? (
          <Field
            label={c.listAddLabel}
            value={text}
            maxLength={200}
            onChange={(e) => setText(e.target.value)}
          />
        ) : (
          <Button variant="quiet" onClick={() => setAdding(true)}>
            {c.listAdd}
          </Button>
        )}
        <Button type="submit" variant="primary" disabled={busy || count === 0}>
          {c.listAsk(count)}
        </Button>
      </form>
    );
  }

  return (
    <div className="cu-surface" role="group" aria-label={c.questionTitle}>
      {/* The agent's own words, shown as they are. */}
      <p className="sh-body">{question.question}</p>
      {options.length > 0 && (
        <div className="sh-chips">
          {options.map((option, i) => (
            <button
              key={option}
              type="button"
              className="sh-chip"
              disabled={busy}
              onClick={() => onAnswer({ optionIndex: i })}
            >
              {option}
            </button>
          ))}
        </div>
      )}
      <form
        className="cu-stack"
        onSubmit={(event) => {
          event.preventDefault();
          if (text.trim() !== '') onAnswer({ text: text.trim() });
        }}
      >
        <Field
          label={c.questionAnswerLabel}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <Button type="submit" variant="primary" disabled={busy || text.trim() === ''}>
          {c.questionSend}
        </Button>
      </form>
    </div>
  );
}
