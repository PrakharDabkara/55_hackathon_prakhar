import { chmodSync, readFileSync, writeFileSync } from 'node:fs';

/** What a run remembers so the next one can reuse the same fake shops (and their tokens). */
export interface SimState {
  version: 1;
  target: string;
  seed: number;
  centre: { lat: number; lng: number };
  radiusM: number;
  shops: { shopId: string; token: string }[];
}

export interface Wanted {
  target: string;
  seed: number;
  centre: { lat: number; lng: number };
  radiusM: number;
  count: number;
}

const isShops = (value: unknown): value is SimState['shops'] =>
  Array.isArray(value) &&
  value.every((s) => typeof s?.shopId === 'string' && typeof s?.token === 'string');

/** The saved state, or null if the file is missing, empty, corrupt or from another format. */
export function loadState(file: string): SimState | null {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<SimState>;
    if (
      raw.version !== 1 ||
      typeof raw.target !== 'string' ||
      typeof raw.seed !== 'number' ||
      typeof raw.radiusM !== 'number' ||
      typeof raw.centre?.lat !== 'number' ||
      typeof raw.centre?.lng !== 'number' ||
      !isShops(raw.shops)
    ) {
      return null;
    }
    return raw as SimState;
  } catch {
    return null;
  }
}

/** Tokens are logins, so the file is readable by the owner only. */
export function saveState(file: string, state: SimState): void {
  writeFileSync(file, JSON.stringify(state, null, 2), { mode: 0o600 });
  chmodSync(file, 0o600);
}

/** True when the saved shops can be reused as they are for this run. */
export function matches(state: SimState | null, want: Wanted): boolean {
  return (
    state !== null &&
    state.target === want.target &&
    state.seed === want.seed &&
    state.radiusM === want.radiusM &&
    state.centre.lat === want.centre.lat &&
    state.centre.lng === want.centre.lng &&
    state.shops.length >= want.count
  );
}
