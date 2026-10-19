import { useEffect, useMemo, useState } from 'react';
import '../customer/orders.css';
import { useT } from '../i18n/index.js';
import { createPushClient, type PushClient, type PushStatus } from '../lib/push.js';
import type { PushApi } from '../lib/pushApi.js';
import { Switch } from '../ui/Switch.js';

interface Props {
  api: PushApi;
  /** For tests: a stand-in for the browser side. */
  client?: PushClient;
}

/**
 * The Notifications switch (ADR-0034). The browser's permission question appears only when this is
 * turned on, never on page load. Hidden where push cannot work or the server has it switched off.
 */
export function NotifyToggle({ api, client }: Props) {
  const { t } = useT();
  const c = t.c;
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

  const help =
    status === 'ios_install'
      ? c.notifyIosHint
      : status === 'blocked'
        ? c.notifyBlocked
        : status === 'on'
          ? c.notifyOnHelp
          : c.notifyOffHelp;

  return (
    <div className="cu-notify" data-notify>
      <Switch
        label={c.notifyTitle}
        checked={status === 'on'}
        disabled={busy || status === 'ios_install' || status === 'blocked'}
        onChange={(next) => void (next ? turnOn() : turnOff())}
      />
      <p className="sh-helper">{help}</p>
      {failed && (
        <p className="sh-alert" role="alert">
          {c.notifyFailed}
        </p>
      )}
    </div>
  );
}
