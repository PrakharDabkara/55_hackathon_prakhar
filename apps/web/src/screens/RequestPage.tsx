import { useCallback, useEffect, useState } from 'react';
import { ScreenBar } from '../customer/ScreenBar.js';
import { useT } from '../i18n/index.js';
import type { LiveOptions } from '../lib/live.js';
import type { SeekerApi, SeekerRequest } from '../lib/seekerApi.js';
import { Button } from '../ui/Button.js';
import { Skeleton } from '../ui/Skeleton.js';
import '../customer/replies.css';
import { Replies } from './Replies.js';

interface Props {
  api: SeekerApi;
  requestId: string;
  navigate: (path: string) => void;
  onDone: () => void;
  /** The request as the search returned it, so the first paint needs no extra fetch. */
  initial?: SeekerRequest;
  /** Where the customer asked from. Missing when opened again from a link: no "you are here". */
  origin?: { lat: number; lng: number };
  /** Fallback poll. Events do the real work; this only covers a stream that is down. */
  pollMs?: number;
  live?: Pick<LiveOptions, 'createSource' | 'retryMs'>;
}

/** /app/request/<id>: your request as a parchi, and the replies to it. */
export function RequestPage({
  api,
  requestId,
  navigate,
  onDone,
  initial,
  origin,
  pollMs = 15_000,
  live,
}: Props) {
  const { t } = useT();
  const [request, setRequest] = useState<SeekerRequest | null>(initial ?? null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (request) return;
    let alive = true;
    api.getRequest(requestId).then(
      (found) => alive && setRequest(found),
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, [api, requestId, request, attempt]);

  const retry = useCallback(() => {
    setFailed(false);
    setAttempt((n) => n + 1);
  }, []);

  if (request)
    return (
      <Replies
        key={request.id}
        api={api}
        initial={request}
        origin={origin ?? null}
        navigate={navigate}
        onDone={onDone}
        pollMs={pollMs}
        live={live}
      />
    );

  return (
    <>
      <ScreenBar title={t.c.repliesTitle} onBack={onDone} />
      <main className="cu-main">
        {failed ? (
          <div className="cu-empty">
            <p className="sh-alert" role="alert">
              {t.c.loadFailed}
            </p>
            <p className="sh-body">{t.c.loadFailedHelp}</p>
            <Button variant="secondary" onClick={retry}>
              {t.c.retry}
            </Button>
          </div>
        ) : (
          <div className="cu-stack" aria-busy="true">
            <Skeleton height="200px" radius="var(--r-md)" />
            <Skeleton height="24px" width="60%" />
            <Skeleton height="96px" radius="var(--r-md)" />
            <Skeleton height="96px" radius="var(--r-md)" />
          </div>
        )}
      </main>
    </>
  );
}
