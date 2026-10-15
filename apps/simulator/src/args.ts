import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export interface CliOptions {
  target: string;
  adminPhone: string;
  count: number;
  speed: number;
  seed: number;
  centre: { lat: number; lng: number };
  radiusM: number;
  stateFile: string;
  reset: boolean;
}

export const USAGE = `Usage: npm run simulate -- --target <url> --admin-phone <phone> [options]

  --target <url>        API to run against, e.g. https://kahanmilega-api.onrender.com
  --admin-phone <phone> a phone listed in ADMIN_PHONES on that server
  --count <n>           shops to simulate, 1-500 (default 100)
  --speed <x>           time multiplier; 10 makes replies 10x faster (default 1)
  --centre <lat,lng>    middle of the shops (default 22.7196,75.8577, Indore)
  --radius <metres>     how far from the centre they spread (default 3000)
  --seed <n>            same seed, same shops and same behaviour (default 1)
  --state-file <path>   where shop tokens are kept between runs (default apps/simulator/.sim-state.json)
  --reset               ignore the state file and make the shops again`;

const DEFAULT_STATE_FILE = fileURLToPath(new URL('../.sim-state.json', import.meta.url));

const whole = (raw: string, name: string, min: number, max: number): number => {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`--${name} must be a whole number from ${min} to ${max}`);
  }
  return n;
};

/** Reads the command line; returns `{ error }` with a message for the person, never throws. */
export function parseCli(argv: string[]): CliOptions | { error: string } {
  try {
    const { values } = parseArgs({
      args: argv,
      strict: true,
      options: {
        target: { type: 'string' },
        'admin-phone': { type: 'string' },
        count: { type: 'string', default: '100' },
        speed: { type: 'string', default: '1' },
        seed: { type: 'string', default: '1' },
        centre: { type: 'string', default: '22.7196,75.8577' },
        radius: { type: 'string', default: '3000' },
        'state-file': { type: 'string', default: DEFAULT_STATE_FILE },
        reset: { type: 'boolean', default: false },
      },
    });

    if (!values.target) throw new Error('--target is required');
    if (!values['admin-phone']) throw new Error('--admin-phone is required');
    const url = new URL(values.target);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('--target must start with http:// or https://');
    }

    const speed = Number(values.speed);
    if (!Number.isFinite(speed) || speed <= 0) throw new Error('--speed must be a number above 0');

    const parts = (values.centre as string).split(',').map((p) => Number(p.trim()));
    const [lat, lng] = parts;
    if (
      parts.length !== 2 ||
      lat === undefined ||
      lng === undefined ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      Math.abs(lat) > 90 ||
      Math.abs(lng) > 180
    ) {
      throw new Error('--centre must be "lat,lng", for example 22.7196,75.8577');
    }

    return {
      target: values.target.replace(/\/+$/, ''),
      adminPhone: values['admin-phone'],
      count: whole(values.count as string, 'count', 1, 500),
      speed,
      seed: whole(values.seed as string, 'seed', 0, 2 ** 31),
      centre: { lat, lng },
      radiusM: whole(values.radius as string, 'radius', 100, 20_000),
      stateFile: values['state-file'] as string,
      reset: values.reset as boolean,
    };
  } catch (error) {
    return { error: (error as Error).message };
  }
}
