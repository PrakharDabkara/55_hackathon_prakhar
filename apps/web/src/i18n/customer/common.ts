import type { Ago } from '../../lib/time.js';

/** Words every customer screen shares (ADR-0042). en is the default: plain, short, verbs on buttons. */
export interface CommonStrings {
  back: string;
  close: string;
  retry: string;
  loading: string;
  loadFailed: string;
  /** What to do when a load failed. */
  loadFailedHelp: string;
  offline: string;
  /** "5 min ago", "just now". */
  ago: (a: Ago) => string;
  km: (km: string) => string;
  optional: string;
  customer: string;
}

export const commonEn: CommonStrings = {
  back: 'Back',
  close: 'Close',
  retry: 'Try again',
  loading: 'Loading',
  loadFailed: "Couldn't load this.",
  loadFailedHelp: 'Check your connection and try again.',
  offline: "You're offline. Reconnect to see the latest.",
  ago: (a) =>
    a.unit === 'now'
      ? 'just now'
      : a.unit === 'min'
        ? `${a.n} min ago`
        : a.unit === 'hour'
          ? `${a.n} h ago`
          : `${a.n} ${a.n === 1 ? 'day' : 'days'} ago`,
  km: (km) => `${km} km`,
  optional: 'optional',
  customer: 'Customer',
};

export const commonHi: CommonStrings = {
  back: 'Wapas',
  close: 'Band karein',
  retry: 'Phir se try karein',
  loading: 'Load ho raha hai',
  loadFailed: 'Ye load nahi hua.',
  loadFailedHelp: 'Internet check karein aur phir try karein.',
  offline: 'Aap offline hain. Naya dekhne ke liye internet jodein.',
  ago: (a) =>
    a.unit === 'now'
      ? 'abhi'
      : a.unit === 'min'
        ? `${a.n} min pehle`
        : a.unit === 'hour'
          ? `${a.n} ghante pehle`
          : `${a.n} din pehle`,
  km: (km) => `${km} km`,
  optional: 'zaroori nahi',
  customer: 'Customer',
};
