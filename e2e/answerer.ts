import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { runSimulator } from '../apps/simulator/src/simulator.ts';

// Run by global-setup.ts as its own process. Twelve simulated shops around the demo location,
// grocery and stationery (seed 5 makes three stationers, so a stationery item has enough shops of
// its own kind), each answering every ping with a yes, using the simulator's own answer logic.
// A customer-made item is answered at random (about 40 % yes), as in production's simulator.
const target = process.env['E2E_TARGET'] as string;
const adminPhone = process.env['E2E_ADMIN_PHONE'] as string;

// One OTP login per phone per run is the limiter's budget: the admin session is kept in
// e2e/.auth/ (not committed) and used again while the server still accepts it.
const authFile = new URL('./.auth/admin.json', import.meta.url).pathname;
const keptToken = (): string | undefined => {
  try {
    const saved = JSON.parse(readFileSync(authFile, 'utf8')) as { phone?: string; token?: string };
    return saved.phone === adminPhone ? saved.token : undefined;
  } catch {
    return undefined;
  }
};

const simulator = await runSimulator({
  target,
  adminPhone,
  count: 12,
  speed: 20, // replies come after 0.25-4.5 s instead of 5-90 s
  seed: 5,
  centre: { lat: 22.7196, lng: 75.8577 },
  radiusM: 1200,
  categories: ['grocery', 'stationery'],
  eager: true,
  ...(keptToken() && { adminToken: keptToken() as string }),
  reset: true,
  stateFile: new URL('./artifacts/answerer-state.json', import.meta.url).pathname,
  log: (line) => console.log(line),
});

mkdirSync(new URL('./.auth', import.meta.url).pathname, { recursive: true });
writeFileSync(authFile, JSON.stringify({ phone: adminPhone, token: simulator.adminToken }));
console.log('READY');
const stop = () => void simulator.stop().then(() => process.exit(0));
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
