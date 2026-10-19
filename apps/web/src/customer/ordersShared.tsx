import { useEffect, useState, type MouseEvent } from 'react';
import { useT } from '../i18n/index.js';
import { Skeleton } from '../ui/Skeleton.js';
import { timeAfter } from '../lib/time.js';
import type { SeekerOrder } from '../lib/orders.js';
import './orders.css';

/** True unless the browser says it is offline. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(
    () => typeof navigator === 'undefined' || navigator.onLine !== false,
  );
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

export function OfflineBanner() {
  const { t } = useT();
  return (
    <p className="sh-banner sh-banner--warn" role="status">
      {t.c.offline}
    </p>
  );
}

/** When it should arrive: out time plus the shop's delivery minutes, if both are known. */
export function arrivalTime(order: Pick<SeekerOrder, 'outForDeliveryAt' | 'feeMinutes'>) {
  return order.outForDeliveryAt && order.feeMinutes != null
    ? timeAfter(order.outForDeliveryAt, order.feeMinutes)
    : null;
}

export function OrdersSkeleton({ rows }: { rows: number }) {
  const { t } = useT();
  return (
    <div className="cu-stack" aria-busy="true" aria-label={t.c.loading} role="group">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} height="72px" radius="var(--r-md)" />
      ))}
    </div>
  );
}

/** A link that opens inside the app on a plain tap, and lets the browser handle ctrl/middle-click. */
export function appLink(navigate: (path: string) => void, path: string) {
  return {
    href: path,
    onClick(event: MouseEvent<HTMLAnchorElement>) {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
      event.preventDefault();
      navigate(path);
    },
  };
}
