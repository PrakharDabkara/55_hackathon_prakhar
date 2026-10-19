import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ShopApi, ShopDemand } from '../../lib/api.js';
import { createPushClient, type PushClient, type PushStatus } from '../../lib/push.js';
import type { PushApi } from '../../lib/pushApi.js';

/** The current time, refreshed so "5m left" stays true without a refetch. */
export function useNow(everyMs = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}

/** Demand for today (1) or the last 7 days; `reload` fetches again. */
export function useDemand(api: Pick<ShopApi, 'shopDemand'>, days: 1 | 7) {
  const [demand, setDemand] = useState<ShopDemand | null>(null);
  const [failed, setFailed] = useState(false);
  const alive = useRef(true);

  const reload = useCallback(async () => {
    try {
      const next = await api.shopDemand(days);
      if (!alive.current) return;
      setDemand(next);
      setFailed(false);
    } catch {
      if (alive.current) setFailed(true);
    }
  }, [api, days]);

  useEffect(() => {
    alive.current = true;
    setDemand(null);
    void reload();
    return () => {
      alive.current = false;
    };
  }, [reload]);

  return { demand, failed, reload };
}

/**
 * Where notifications stand on this device (ADR-0034). It only looks on load; the browser's
 * permission question appears when `enable` is called from a tap.
 */
export function usePush(api: PushApi, client?: PushClient) {
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

  const enable = useCallback(async () => {
    setBusy(true);
    setFailed(false);
    try {
      const result = await push.enable();
      setFailed(result === 'failed');
      if (result === 'on' || result === 'blocked' || result === 'ios_install') setStatus(result);
    } finally {
      setBusy(false);
    }
  }, [push]);

  const disable = useCallback(async () => {
    setBusy(true);
    try {
      await push.disable();
      setStatus('off');
    } finally {
      setBusy(false);
    }
  }, [push]);

  return { status, busy, failed, enable, disable };
}
