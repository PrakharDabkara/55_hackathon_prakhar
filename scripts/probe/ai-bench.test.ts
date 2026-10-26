import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const script = join(import.meta.dirname, 'ai-bench.sh');
const main = join(import.meta.dirname, '../../apps/api/src/aiBenchMain.ts');
const KEY = `AIza${'x'.repeat(35)}`;
const run = (env: Record<string, string>, input = '') =>
  spawnSync('bash', [script], {
    encoding: 'utf8',
    input,
    env: { PATH: process.env['PATH'] ?? '', HOME: '/nonexistent', ...env },
  });

// Round 3: the benchmark spends the evals project's quota, so it must never pick up the app's own key.
describe('scripts/probe/ai-bench.sh', () => {
  it('refuses text that is not a Gemini key, before building or calling anything', () => {
    const r = run({}, 'not-a-key\n');
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/does not look like a Gemini API key/);
  });

  it("refuses the shell's own GEMINI_API_KEY as the bench key, and never prints it", () => {
    const r = run({ GEMINI_API_KEY: KEY, GEMINI_PROBE_KEY: KEY });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/GEMINI_API_KEY of this shell/);
    expect(r.stdout + r.stderr).not.toContain(KEY);
  });

  it('reads the key with read -rs or GEMINI_PROBE_KEY and loads no settings file', () => {
    const sh = readFileSync(script, 'utf8');
    const settingsFile = new RegExp(`(^|[\\s'"/])\\.${'env'}\\b|dotenv|env-file|^\\s*source `, 'm');
    expect(sh).toContain('probe_read_key');
    expect(sh).toContain('probe_redact');
    expect(sh).not.toMatch(settingsFile);
    const ts = readFileSync(main, 'utf8');
    expect(ts).toContain("process.env['GEMINI_BENCH_KEY']");
    expect(ts).not.toContain("process.env['GEMINI_API_KEY']");
    expect(ts).not.toMatch(settingsFile);
    expect(ts).toContain('sanitiseMessage');
  });
});
