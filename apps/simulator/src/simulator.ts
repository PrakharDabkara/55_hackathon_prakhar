import { ApiFailure, createClient } from './client.ts';
import { decide, makeProfile, type ShopProfile } from './decision.ts';
import { createRng, hashSeed } from './rng.ts';
import { readSse } from './sse.ts';
import { loadState, matches, saveState } from './state.ts';

export interface SimulatorOptions {
  target: string;
  adminPhone: string;
  count: number;
  /** Replies come this many times faster than real life. */
  speed: number;
  seed: number;
  centre: { lat: number; lng: number };
  radiusM: number;
  stateFile: string;
  /** Ignore the state file and make the shops again. */
  reset?: boolean;
  /** Make shops of these categories only (default: the realistic mix). */
  categories?: string[];
  /** Every shop answers every ping with a yes: for tests and demos that must not depend on luck. */
  eager?: boolean;
  log?: (line: string) => void;
}

export interface Stats {
  answered: number;
  yes: number;
  no: number;
  /** Pings this shop chose not to answer. */
  skipped: number;
  /** Answers that came back "too late" (the ping had closed). */
  late: number;
  failed: number;
}

export interface Simulator {
  stats(): Stats;
  /** Stops listening, cancels answers not yet sent and waits for the stream to close. Safe to repeat. */
  stop(): Promise<void>;
}

interface Shop {
  shopId: string;
  token: string;
  profile: ShopProfile;
}

const short = (id: string) => id.slice(0, 8);
const clock = () => new Date().toTimeString().slice(0, 8);
const rupees = (paise: number) => `₹${(paise / 100).toFixed(paise % 100 === 0 ? 0 : 2)}`;

/**
 * Fake shops that answer real pings. It logs in as the admin, makes (or reuses) the shops on the
 * server, opens ONE admin stream that carries every simulated shop's pings, and answers each as
 * that shop through the same POST /pings/:id/answer the shop app uses.
 */
export async function runSimulator(options: SimulatorOptions): Promise<Simulator> {
  const { target, count, speed, seed } = options;
  const log = options.log ?? ((line: string) => console.log(line));
  const client = createClient(target);
  const abort = new AbortController();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const inFlight = new Set<Promise<void>>();
  const stats: Stats = { answered: 0, yes: 0, no: 0, skipped: 0, late: 0, failed: 0 };
  let stopped = false;

  let admin: { token: string; role: string };
  try {
    admin = await client.login(options.adminPhone, abort.signal);
  } catch (error) {
    if (error instanceof ApiFailure && error.code === 'rate_limited') {
      throw new Error('Too many OTP requests for this phone. Wait about 10 minutes and try again.');
    }
    throw error;
  }
  if (admin.role !== 'admin') {
    throw new Error(
      `${options.adminPhone} is not an admin on ${target}. Put it in ADMIN_PHONES on the server and restart it.`,
    );
  }

  const shops = new Map<string, Shop>();
  const saved = options.reset ? null : loadState(options.stateFile);
  const want = { target, seed, centre: options.centre, radiusM: options.radiusM, count };
  let logins: { shopId: string; token: string }[];
  if (matches(saved, want) && (await client.shopIsAlive(saved?.shops[0]?.token ?? ''))) {
    logins = (saved?.shops ?? []).slice(0, count);
    log(`${clock()}  reusing ${logins.length} shops from ${options.stateFile}`);
  } else {
    log(`${clock()}  creating ${count} shops around ${options.centre.lat},${options.centre.lng}`);
    // Without tokens for the old ones, a clean slate is the only safe start.
    await client.removeShops(admin.token);
    logins = await client.createShops(admin.token, {
      count,
      centre: options.centre,
      radiusM: options.radiusM,
      seed,
      ...(options.categories && { categories: options.categories }),
    });
    saveState(options.stateFile, {
      version: 1,
      target,
      seed,
      centre: options.centre,
      radiusM: options.radiusM,
      shops: logins,
    });
  }
  for (const login of logins) {
    shops.set(login.shopId, {
      ...login,
      profile: options.eager
        ? { replyProbability: 1, alwaysNo: false }
        : makeProfile(createRng(hashSeed(seed, login.shopId))),
    });
  }

  async function sendAnswer(
    shop: Shop,
    pingId: string,
    body: Record<string, unknown>,
    delayMs: number,
  ) {
    const detail = [
      body['answer'],
      body['pricePaise'] !== undefined ? rupees(body['pricePaise'] as number) : null,
      body['quantityHint'] ? `(${body['quantityHint'] as string})` : null,
    ]
      .filter(Boolean)
      .join('  ');
    const line = `${clock()}  shop ${short(shop.shopId)}  ${detail}  ping ${short(pingId)}  +${(delayMs / 1000).toFixed(1)}s`;
    try {
      await client.answer(shop.token, pingId, body, abort.signal);
      stats.answered++;
      if (body['answer'] === 'yes') stats.yes++;
      else stats.no++;
      log(line);
    } catch (error) {
      if (stopped) return;
      if (error instanceof ApiFailure && (error.status === 409 || error.status === 404)) {
        stats.late++;
        log(`${line}  too late (${error.status})`);
      } else {
        stats.failed++;
        log(`${line}  FAILED: ${(error as Error).message}`);
      }
    }
  }

  function onPing(data: unknown) {
    const d = data as {
      pingId?: unknown;
      shopId?: unknown;
      refPricePaise?: unknown;
      category?: unknown;
    } | null;
    if (typeof d?.pingId !== 'string' || typeof d.shopId !== 'string') return;
    const shop = shops.get(d.shopId);
    if (!shop) return; // a simulated shop from some other run
    const decision = decide(
      shop.profile,
      {
        refPricePaise: typeof d.refPricePaise === 'number' ? d.refPricePaise : null,
        category: typeof d.category === 'string' ? d.category : null,
      },
      createRng(hashSeed(seed, d.shopId, d.pingId)),
      speed,
    );
    if (decision.kind === 'skip') {
      stats.skipped++;
      return;
    }
    const pingId = d.pingId;
    const timer = setTimeout(() => {
      timers.delete(timer);
      const task = sendAnswer(shop, pingId, { ...decision.body }, decision.delayMs).finally(() =>
        inFlight.delete(task),
      );
      inFlight.add(task);
    }, decision.delayMs);
    timers.add(timer);
  }

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      abort.signal.addEventListener('abort', () => (clearTimeout(timer), resolve()), {
        once: true,
      });
    });

  // One stream for every shop. The first connection must work or we fail loudly; after that a drop
  // is retried with a new ticket, slower each time.
  let opened: () => void = () => undefined;
  let failedToOpen: (error: unknown) => void = () => undefined;
  const ready = new Promise<void>((resolve, reject) => {
    opened = resolve;
    failedToOpen = reject;
  });

  async function streamLoop() {
    let first = true;
    let backoff = 1000;
    while (!stopped) {
      try {
        const ticket = await client.ticket(admin.token, abort.signal);
        const res = await fetch(client.streamUrl(ticket), {
          signal: abort.signal,
          headers: { accept: 'text/event-stream' },
        });
        if (!res.ok || !res.body)
          throw new Error(`the event stream was refused (HTTP ${res.status})`);
        log(
          `${clock()}  ${first ? 'listening' : 'listening again'} for pings from ${shops.size} shops`,
        );
        if (first) opened();
        first = false;
        backoff = 1000;
        for await (const message of readSse(res.body as unknown as AsyncIterable<Uint8Array>)) {
          if (message.event === 'ping.created') onPing(message.data);
        }
      } catch (error) {
        if (stopped) return;
        if (first) {
          failedToOpen(error);
          return;
        }
        log(
          `${clock()}  stream dropped (${(error as Error).message}); retrying in ${backoff / 1000}s`,
        );
      }
      if (stopped) return;
      await sleep(backoff);
      backoff = Math.min(backoff * 2, 15_000);
    }
  }

  const loop = streamLoop();
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    abort.abort();
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    await Promise.allSettled([loop, ...inFlight]);
    log(
      `${clock()}  stopped: ${stats.answered} answers (${stats.yes} yes, ${stats.no} no), ${stats.skipped} ignored, ${stats.late} too late, ${stats.failed} failed`,
    );
  };

  try {
    await ready;
  } catch (error) {
    await stop();
    throw error;
  }
  return { stats: () => ({ ...stats }), stop };
}
