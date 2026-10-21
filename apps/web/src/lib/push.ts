import type { PushApi, PushSubscriptionBody } from './pushApi.js';

/**
 * Where notifications stand on this device (ADR-0034):
 * unsupported: this browser cannot do push · disabled: the server has push switched off ·
 * ios_install: iPhone, until the app is added to the Home Screen · blocked: the person said no in
 * the browser · off: can be turned on · on: turned on.
 */
export type PushStatus = 'unsupported' | 'disabled' | 'ios_install' | 'blocked' | 'off' | 'on';

export type EnableResult = 'on' | 'off' | 'blocked' | 'ios_install' | 'failed';

export interface PushClient {
  /** Never asks for anything: it only looks. */
  status(): Promise<PushStatus>;
  /** Asks the browser for permission. Call it only from a tap, never on page load. */
  enable(): Promise<EnableResult>;
  disable(): Promise<void>;
  /** Tells the server about a subscription the browser already has. Never prompts. */
  resync(): Promise<void>;
}

/** What the Account screen needs on top: log out and delete end the login, so they carry the endpoint. */
export interface DevicePushClient extends PushClient {
  /**
   * Drops this browser's subscription and returns its endpoint, without telling the server: log out
   * and delete pass it along in their own call, since the login ends there. Null if none.
   */
  forgetDevice(): Promise<string | null>;
}

/** The browser's side, so the logic above it can be tested without a browser. */
export interface PushEnv {
  supported: boolean;
  /** An iPhone or iPad where the app is still a Safari tab: push only works from the Home Screen. */
  iosNeedsInstall: boolean;
  permission(): NotificationPermission;
  requestPermission(): Promise<NotificationPermission>;
  getSubscription(): Promise<PushSubscriptionBody | null>;
  subscribe(publicKey: string): Promise<PushSubscriptionBody>;
  /** Drops this browser's subscription; returns its endpoint, or null if there was none. */
  unsubscribe(): Promise<string | null>;
}

/** The server key arrives URL-safe base64; the browser wants bytes. */
export function urlBase64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = (value + '='.repeat((4 - (value.length % 4)) % 4))
    .replaceAll('-', '+')
    .replaceAll('_', '/');
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export function createPushClient(api: PushApi, env: PushEnv = browserEnv()): DevicePushClient {
  const config = () => api.pushConfig().catch(() => ({ enabled: false as const }));

  return {
    async status() {
      if (!env.supported && !env.iosNeedsInstall) return 'unsupported';
      if (!(await config()).enabled) return 'disabled';
      if (env.iosNeedsInstall) return 'ios_install';
      if (env.permission() === 'denied') return 'blocked';
      if (env.permission() === 'granted' && (await env.getSubscription())) return 'on';
      return 'off';
    },

    async enable() {
      if (env.iosNeedsInstall) return 'ios_install';
      const server = await config();
      if (!server.enabled) return 'failed';
      const permission = await env.requestPermission();
      if (permission === 'denied') return 'blocked';
      if (permission !== 'granted') return 'off';
      try {
        await api.pushSubscribe(await env.subscribe(server.publicKey));
        return 'on';
      } catch {
        // Do not leave a browser subscription the server does not know about.
        await env.unsubscribe().catch(() => undefined);
        return 'failed';
      }
    },

    async disable() {
      const endpoint = await env.unsubscribe().catch(() => null);
      // If the server cannot be told, its next push to this browser gets a 410 and it forgets it.
      if (endpoint) await api.pushUnsubscribe(endpoint).catch(() => undefined);
    },

    async forgetDevice() {
      return env.unsubscribe().catch(() => null);
    },

    async resync() {
      if (!env.supported || env.permission() !== 'granted') return;
      const sub = await env.getSubscription().catch(() => null);
      if (sub) await api.pushSubscribe(sub).catch(() => undefined);
    },
  };
}

const SW_URL = '/app/sw.js';
const SW_SCOPE = '/app/';

/** Registers the service worker; harmless to call twice, and not a permission prompt. */
export function registerServiceWorker(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE }).catch(() => undefined);
}

function toBody(sub: PushSubscription): PushSubscriptionBody {
  const json = sub.toJSON();
  const keys = json.keys;
  if (!json.endpoint || !keys?.['p256dh'] || !keys['auth'])
    throw new Error('incomplete subscription');
  return { endpoint: json.endpoint, keys: { p256dh: keys['p256dh'], auth: keys['auth'] } };
}

export function browserEnv(): PushEnv {
  const hasPush =
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window;
  const ua = navigator.userAgent;
  const isIos =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const installed =
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;

  const registration = async () => {
    await navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE });
    return navigator.serviceWorker.ready;
  };

  return {
    supported: hasPush,
    iosNeedsInstall: isIos && !installed,
    permission: () => Notification.permission,
    requestPermission: () => Notification.requestPermission(),
    async getSubscription() {
      const sub = await (await registration()).pushManager.getSubscription();
      return sub ? toBody(sub) : null;
    },
    async subscribe(publicKey) {
      const manager = (await registration()).pushManager;
      const options = { userVisibleOnly: true, applicationServerKey: urlBase64ToBytes(publicKey) };
      try {
        return toBody(await manager.subscribe(options));
      } catch (error) {
        // A subscription made with another server key blocks a new one: drop it and try once more.
        const old = await manager.getSubscription();
        if (!old) throw error;
        await old.unsubscribe();
        return toBody(await manager.subscribe(options));
      }
    },
    async unsubscribe() {
      const sub = await (await registration()).pushManager.getSubscription();
      if (!sub) return null;
      const { endpoint } = sub;
      await sub.unsubscribe();
      return endpoint;
    },
  };
}
