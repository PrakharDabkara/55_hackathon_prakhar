import { useEffect, useMemo, useState } from 'react';
import { useT } from '../i18n/index.js';
import { createPushClient, type PushClient, type PushStatus } from '../lib/push.js';
import type { PushApi } from '../lib/pushApi.js';

interface Props {
  api: PushApi;
  /** For tests: a stand-in for the browser side. */
  client?: PushClient;
}

/**
 * "Notification chalu karein" (ADR-0034). The browser's permission question appears only when this
 * is tapped, never on page load. Hidden where push cannot work or the server has it switched off.
 */
export function NotifyToggle({ api, client }: Props) {
  const { t } = useT();
  const push = useMemo(() => client ?? createPushClient(api), [api, client]);
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    push.status().then(
      (next) => {
        if (!alive) return;
        setStatus(next);
        // Already on here: make sure the server still has this device. No prompt.
        if (next === 'on') void push.resync();
      },
      () => alive && setStatus('unsupported'),
    );
    return () => {
      alive = false;
    };
  }, [push]);

  if (status === null || status === 'unsupported' || status === 'disabled') return null;

  async function turnOn() {
    setBusy(true);
    setFailed(false);
    try {
      const result = await push.enable();
      setFailed(result === 'failed');
      setStatus(result === 'on' ? 'on' : result === 'blocked' ? 'blocked' : status);
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    try {
      await push.disable();
      setStatus('off');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="notify" data-notify>
      {status === 'on' ? (
        <button
          type="button"
          className="btn btn-quiet"
          disabled={busy}
          onClick={() => void turnOff()}
        >
          {t.notifyOff}
        </button>
      ) : status === 'blocked' ? (
        <p className="hint">{t.notifyBlocked}</p>
      ) : (
        <button
          type="button"
          className="btn btn-quiet"
          disabled={busy || status === 'ios_install'}
          onClick={() => void turnOn()}
        >
          {t.notifyOn}
        </button>
      )}
      {status === 'ios_install' && <p className="hint">{t.notifyIosHint}</p>}
      {failed && (
        <p className="alert" role="alert">
          {t.notifyFailed}
        </p>
      )}
    </div>
  );
}
