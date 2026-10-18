import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ResultsMap } from '../components/ResultsMap.js';
import { useT } from '../i18n/index.js';
import { formatCountdown, formatDistance } from '../lib/format.js';
import type { LiveOptions } from '../lib/live.js';
import { formatRupees } from '../lib/money.js';
import { directionsUrl, pinsFor, sortResults, type SortKey } from '../lib/results.js';
import type { SeekerApi, SeekerRequest } from '../lib/seekerApi.js';
import { useLive } from '../lib/useLive.js';

interface Props {
  api: SeekerApi;
  /** The request as the search returned it, so the first paint needs no extra fetch. */
  initial: SeekerRequest;
  origin: { lat: number; lng: number };
  onDone: () => void;
  /** Fallback poll. Events do the real work; this only covers a stream that is down. */
  pollMs?: number;
  live?: Pick<LiveOptions, 'createSource' | 'retryMs'>;
}

/** The map, who said yes and at what price, how the asking is going, and how long is left. */
export function Results({ api, initial, origin, onDone, pollMs = 15_000, live }: Props) {
  const { t } = useT();
  const [request, setRequest] = useState(initial);
  const [sort, setSort] = useState<SortKey>(
    initial.targetPricePaise !== undefined ? 'price' : 'distance',
  );
  const [now, setNow] = useState(() => Date.now());
  const [closing, setClosing] = useState(false);
  const alive = useRef(true);

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

  // Each server event is only a hint: fetch the request again and draw what it says.
  const refresh = useCallback(() => {
    api
      .getRequest(initial.id)
      .then((next) => {
        if (alive.current) setRequest(next);
      })
      .catch(() => undefined);
  }, [api, initial.id]);
  const getTicket = useCallback(() => api.eventTicket(), [api]);
  const isLive = useLive({ getTicket, refresh, pollMs, live });

  const rows = useMemo(() => sortResults(request.results, sort), [request.results, sort]);
  const pins = useMemo(() => pinsFor(request.results), [request.results]);

  const { sent, yes, no, pending } = request.pingStats;
  const active = request.state === 'PINGING' || request.state === 'ANSWERED';
  const remaining = new Date(request.expiresAt).getTime() - now;

  let clock: string | null = null;
  if (request.state === 'CLOSED') clock = t.requestClosed;
  else if (!active || remaining <= 0) clock = t.timeUp;
  else clock = t.timeLeft(formatCountdown(remaining));

  async function finish() {
    setClosing(true);
    try {
      await api.closeRequest(request.id);
    } catch {
      // Closing is a courtesy; the request expires on its own.
    }
    onDone();
  }

  return (
    <section className="results" aria-live="polite">
      <header className="results-head">
        {request.item && (
          <div>
            <h1 className="item-hi" lang="hi">
              {request.item.nameHi}
            </h1>
            <p className="item-en" lang="en">
              {request.item.nameEn}
            </p>
          </div>
        )}
        {isLive && <span className="live-dot" role="img" aria-label={t.live} title={t.live} />}
      </header>

      {request.item?.unverified && (
        <p className="status-badge warn" role="status">
          {t.newItemNote}
        </p>
      )}

      <ResultsMap origin={origin} pins={pins} label={t.mapLabel} youAreHere={t.youAreHere} />

      <p className="status-line">
        {sent > 0
          ? t.statusLine(sent, yes, no, pending)
          : active && request.state === 'PINGING'
            ? t.statusWaiting
            : t.statusFromMemory}
      </p>
      <p className="countdown">{clock}</p>

      <div className="sort" role="group" aria-label={t.sortLabel}>
        {(['price', 'distance'] as const).map((key) => (
          <button
            key={key}
            type="button"
            className="chip"
            aria-pressed={sort === key}
            onClick={() => setSort(key)}
          >
            {key === 'price' ? t.sortCheap : t.sortNear}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="empty">{t.noYesYet}</p>
      ) : (
        <ul className="result-list">
          {rows.map((r) => (
            <li key={r.shopId} className="result">
              <div className="result-main">
                <h3>{r.name}</h3>
                <p className="price">
                  {r.pricePaise === null ? t.noPrice : formatRupees(r.pricePaise)}
                </p>
                {r.savingsPaise !== undefined && r.savingsPaise > 0 && (
                  <p className="badge">{t.saveBadge(formatRupees(r.savingsPaise))}</p>
                )}
                <p className="meta">{t.away(formatDistance(r.distanceM))}</p>
                <p className="meta">{r.freshness}</p>
                {r.quantityHint && (
                  <p className="meta">{r.quantityHint === 'few' ? t.few : t.plenty}</p>
                )}
              </div>
              <a
                className="btn btn-quiet route"
                href={directionsUrl(r.lat, r.lng)}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t.route}
              </a>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        className="btn btn-yes"
        disabled={closing}
        onClick={() => void finish()}
      >
        {t.done}
      </button>
    </section>
  );
}
