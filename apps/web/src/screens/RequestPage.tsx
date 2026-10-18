import { useEffect, useState } from 'react';
import { useT } from '../i18n/index.js';
import type { SeekerApi, SeekerRequest } from '../lib/seekerApi.js';
import { Results } from './Results.js';

interface Props {
  api: SeekerApi;
  requestId: string;
  onDone: () => void;
}

/**
 * An earlier search opened again, at /app/request/<id>. The server never sends back where the
 * customer stood, so the map is drawn around the shops that answered.
 */
export function RequestPage({ api, requestId, onDone }: Props) {
  const { t } = useT();
  const [request, setRequest] = useState<SeekerRequest | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    api.getRequest(requestId).then(
      (found) => alive && setRequest(found),
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, [api, requestId]);

  if (request)
    return <Results key={request.id} api={api} initial={request} origin={null} onDone={onDone} />;
  return failed ? (
    <div className="stack">
      <p className="alert" role="alert">
        {t.errGeneric}
      </p>
      <button type="button" className="btn btn-quiet" onClick={onDone}>
        {t.homeBack}
      </button>
    </div>
  ) : (
    <p className="empty">{t.loading}</p>
  );
}
