import { parseCli, USAGE } from './args.ts';
import { runSimulator } from './simulator.ts';

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(USAGE);
  process.exit(0);
}

const options = parseCli(process.argv.slice(2));
if ('error' in options) {
  console.error(`${options.error}\n\n${USAGE}`);
  process.exit(2);
}

try {
  const simulator = await runSimulator(options);
  // Ctrl+C: stop listening, cancel unsent answers, print the summary, and let the process end.
  const stop = () => void simulator.stop().then(() => (process.exitCode = 0));
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
} catch (error) {
  console.error(`Could not start: ${(error as Error).message}`);
  process.exit(1);
}
