import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { PhotoPicker } from '../components/PhotoPicker.js';
import { useT } from '../i18n/index.js';
import { ApiError } from '../lib/api.js';
import { isFinalState, shownProgress } from '../lib/errand.js';
import { formatCountdown } from '../lib/format.js';
import type { PhotoApi } from '../lib/photoApi.js';
import type { LiveOptions } from '../lib/live.js';
import { rupeesToPaise } from '../lib/money.js';
import type {
  ErrandAnswer,
  ErrandQuestion,
  ErrandView,
  NewErrand,
  SeekerApi,
} from '../lib/seekerApi.js';
import { useLive } from '../lib/useLive.js';
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
  /** Fallback poll. Events do the real work; this only covers a stream that is down. */
  pollMs?: number;
  live?: Pick<LiveOptions, 'createSource' | 'retryMs'>;
}

/** The errand screen: describe the task, watch the agent work, read the two plans. */
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
      onRestart={start}
      onNew={() => open(null)}
    />
  ) : (
    <ErrandForm onStart={start} onBack={onBack} />
  );
}

function ErrandForm({
  onStart,
  onBack,
}: {
  onStart: (input: NewErrand) => Promise<void>;
  onBack: () => void;
}) {
  const { t } = useT();
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
      if (!parsed.ok) return setError(t.badPrice);
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
    <form className="stack" onSubmit={(event) => void submit(event)}>
      <button type="button" className="btn btn-quiet" onClick={onBack}>
        {t.errandBack}
      </button>
      <label className="field field-big">
        <span className="query-label">{t.errandTaskLabel}</span>
        <textarea
          className="task-input"
          rows={4}
          maxLength={500}
          value={task}
          onChange={(e) => setTask(e.target.value)}
        />
      </label>
      <div className="stack-tight">
        <p className="chips-title">{t.errandExamplesTitle}</p>
        {t.errandExamples.map((example) => (
          <button
            key={example}
            type="button"
            className="btn btn-no example"
            onClick={() => setTask(example)}
          >
            {example}
          </button>
        ))}
      </div>
      <label className="field">
        <span>{t.errandBudgetLabel}</span>
        <input
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={budget}
          onChange={(e) => setBudget(e.target.value)}
        />
      </label>
      <div className="actions">
        <button type="button" className="btn btn-quiet" onClick={useMyLocation}>
          {t.useMyLocation}
        </button>
        <button
          type="button"
          className="btn btn-quiet"
          onClick={() => {
            setWhere(DEMO);
            setHow('demo');
            setLocationFailed(false);
          }}
        >
          {t.demoLocation}
        </button>
      </div>
      {how === 'phone' && <p role="status">{t.locationOk}</p>}
      {how === 'demo' && <p role="status">✓ {t.demoLocation}</p>}
      {locationFailed && <p role="status">{t.locationFailed}</p>}
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="btn btn-yes" disabled={!ready || busy}>
        {busy ? t.errandMaking : t.errandMake}
      </button>
    </form>
  );
}

function errorText(error: unknown, t: ReturnType<typeof useT>['t']): string {
  if (error instanceof ApiError) {
    if (error.code === 'task_rejected') return t.errErrandRejected;
    if (error.code === 'errand_rate_limited' || error.status === 429) return t.errErrandLimit;
    if (error.status === 403) return t.errNotSeeker;
  }
  return t.errGeneric;
}

interface RunProps {
  api: SeekerApi;
  id: string;
  pollMs: number;
  live: Props['live'] | undefined;
  /** A new errand with this errand's task and place. */
  onRestart: (input: NewErrand) => Promise<void>;
  onNew: () => void;
}

/** One errand in flight: refetched on every server hint, and on a slow poll as a fallback. */
function ErrandRun({ api, id, pollMs, live, onRestart, onNew }: RunProps) {
  const { t } = useT();
  const [view, setView] = useState<ErrandView | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
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
    setView(next);
  }, []);
  const refresh = useCallback(() => {
    if (finished.current) return;
    api
      .getErrand(id)
      .then(show)
      .catch((e: unknown) => {
        // An old or foreign link: say so once, instead of waiting for ever.
        if (alive.current && e instanceof ApiError && e.status === 404) setGone(true);
      });
  }, [api, id, show]);
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
      if (alive.current) setError(t.errGeneric);
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

  if (gone)
    return (
      <section className="stack">
        <p className="alert">{t.errandGone}</p>
        <button type="button" className="btn btn-quiet" onClick={onNew}>
          {t.errandNew}
        </button>
      </section>
    );

  if (!view) return <p className="empty">{t.loading}</p>;

  // While a question is open the question box says it; the timeline repeating it is noise.
  const lines = shownProgress(view.progress).filter(
    (line) => view.state !== 'NEEDS_INPUT' || !line.startsWith('Aapse ek sawaal'),
  );
  const active =
    view.state === 'PLANNING' || view.state === 'WAITING_FOR_SHOPS' || view.state === 'NEEDS_INPUT';
  const elapsed = formatCountdown(Math.max(0, now - new Date(view.createdAt).getTime()));
  const ready = view.state === 'PLAN_READY' && view.plan?.plans;

  const timeline = (
    <ol className="timeline" aria-label={t.errandProgressTitle}>
      {lines.map((line, i) => (
        <li key={`${i}-${line}`}>{line}</li>
      ))}
    </ol>
  );

  return (
    <section className="stack" aria-live="polite">
      <header className="results-head errand-head">
        <h1 className="errand-task">{view.task}</h1>
        <span className={`state-chip state-${view.state}`}>{t.errandStates[view.state]}</span>
      </header>

      {view.state === 'WAITING_FOR_SHOPS' && (
        <div className="waiting" role="status">
          <p>{t.errandWaiting}</p>
          <p className="meta">{t.errandElapsed(elapsed)}</p>
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
            origin={origin}
            busy={busy}
            onAskAgain={() => void again()}
          />
          <details className="timeline-box">
            <summary>{t.errandProgressTitle}</summary>
            {timeline}
          </details>
          {view.lateAnswers.length > 0 && (
            <details className="late-box">
              <summary>{t.errandLateTitle(view.lateAnswers.length)}</summary>
              <ul>
                {view.lateAnswers.map((line, i) => (
                  <li key={`${i}-${line}`}>{line}</li>
                ))}
              </ul>
            </details>
          )}
        </>
      ) : (
        timeline
      )}

      {view.state === 'FAILED' && (
        <p className="alert" role="alert">
          {t.errandFailed}{' '}
          {view.failureReason === 'ai_unavailable' ? t.errandFailedAi : t.errGeneric}
        </p>
      )}
      {view.state === 'EXPIRED' && <p className="alert">{t.errandExpired}</p>}
      {view.state === 'CANCELLED' && <p className="alert">{t.errandCancelled}</p>}
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}

      {active && (
        <button
          type="button"
          className="btn btn-no"
          disabled={busy}
          onClick={() => void act(() => api.cancelErrand(id))}
        >
          {t.errandCancel}
        </button>
      )}
      {view.state === 'FAILED' && (
        <button type="button" className="btn btn-yes" disabled={busy} onClick={() => void again()}>
          {t.errandRetry}
        </button>
      )}
      {!active && (
        <button type="button" className="btn btn-quiet" onClick={onNew}>
          {t.errandNew}
        </button>
      )}
    </section>
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
  const [text, setText] = useState('');
  const [ticked, setTicked] = useState<Set<number>>(() => new Set(question.preselected ?? []));
  const list = question.multiSelect === true && (question.options?.length ?? 0) > 0;

  if (list) {
    const extra = text.trim();
    return (
      <form
        className="choice"
        role="group"
        aria-label={t.errandQuestionTitle}
        onSubmit={(event) => {
          event.preventDefault();
          onAnswer({
            selected: [...ticked].sort((a, b) => a - b),
            ...(extra !== '' && { text: extra }),
          });
        }}
      >
        <p className="choice-question">{question.question}</p>
        {question.options?.map((option, i) => (
          <div key={option} className="check-row">
            <label className="check-option">
              <input
                type="checkbox"
                checked={ticked.has(i)}
                disabled={busy}
                onChange={(e) =>
                  setTicked((current) => {
                    const next = new Set(current);
                    if (e.target.checked) next.add(i);
                    else next.delete(i);
                    return next;
                  })
                }
              />
              <span>{option}</span>
            </label>
            <PhotoPicker
              api={photos}
              role="request"
              label={option}
              errand={{ id: errandId, label: option }}
              onChange={() => undefined}
            />
          </div>
        ))}
        <label className="field">
          <span>{t.errandMore}</span>
          <input type="text" value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        <button
          type="submit"
          className="btn btn-yes"
          disabled={busy || (ticked.size === 0 && extra === '')}
        >
          {t.errandConfirmList}
        </button>
      </form>
    );
  }

  return (
    <div className="choice" role="group" aria-label={t.errandQuestionTitle}>
      <p className="choice-question">{question.question}</p>
      {question.options?.map((option, i) => (
        <button
          key={option}
          type="button"
          className="btn btn-no choice-option"
          disabled={busy}
          onClick={() => onAnswer({ optionIndex: i })}
        >
          {option}
        </button>
      ))}
      <form
        className="stack-tight"
        onSubmit={(event) => {
          event.preventDefault();
          if (text.trim() !== '') onAnswer({ text: text.trim() });
        }}
      >
        <label className="field">
          <span>{t.errandAnswerLabel}</span>
          <input type="text" value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        <button type="submit" className="btn btn-yes" disabled={busy || text.trim() === ''}>
          {t.send}
        </button>
      </form>
    </div>
  );
}
