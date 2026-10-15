import { runSimulator } from '../apps/simulator/src/simulator.ts';

// Run by global-setup.ts as its own process. Five simulated grocery shops around the demo
// location, each answering every ping with a yes, using the simulator's own answer logic.
const target = process.env['E2E_TARGET'] as string;
const adminPhone = process.env['E2E_ADMIN_PHONE'] as string;

const simulator = await runSimulator({
  target,
  adminPhone,
  count: 5,
  speed: 20, // replies come after 0.25-4.5 s instead of 5-90 s
  seed: 5,
  centre: { lat: 22.7196, lng: 75.8577 },
  radiusM: 1200,
  categories: ['grocery'],
  eager: true,
  reset: true,
  stateFile: new URL('./artifacts/answerer-state.json', import.meta.url).pathname,
  log: (line) => console.log(line),
});

console.log('READY');
const stop = () => void simulator.stop().then(() => process.exit(0));
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
