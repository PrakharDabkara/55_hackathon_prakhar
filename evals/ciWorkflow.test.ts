import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const yml = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
const deploy = /^ {2}deploy:\n((?: {4}.*\n|\n)+)/m.exec(yml)?.[1] ?? '';
const step = (name: string) =>
  new RegExp(`^ {6}- name: ${name}\\n((?: {8}.*\\n)+)`, 'm').exec(deploy)?.[1] ?? '';

// ADR-0021 amendment: a failing embedding step (quota, 503, timeout) must not stop a deploy. The
// per-item hash lets the next deploy finish the work.
describe('.github/workflows/ci.yml: the deploy job', () => {
  const embed = step('Embed catalog on Neon');

  it('has the embedding step between the seed and the Render trigger', () => {
    const order = [
      'Run migrations on Neon',
      'Seed catalog on Neon',
      'Embed catalog on Neon',
      'Trigger Render deploy',
    ].map((n) => deploy.indexOf(`- name: ${n}`));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('lets the job go on when the embedding step fails, and bounds how long it may run', () => {
    expect(embed).toMatch(/continue-on-error:\s*true/);
    expect(embed).toMatch(/timeout-minutes:\s*\d+/);
  });

  it('runs the script in its non-blocking mode, which reports in the job summary', () => {
    expect(embed).toContain('EMBED_NON_BLOCKING');
    expect(embed).toContain('GITHUB_STEP_SUMMARY');
    expect(embed).toContain('npm run ai:embed-catalog');
  });

  it('does not make the Render trigger wait for a successful embedding', () => {
    const trigger = step('Trigger Render deploy');
    expect(trigger).not.toMatch(/\bif:/);
    expect(trigger).toContain('DEPLOY_HOOK_URL');
  });

  it('keeps the migrations strict: they still stop the deploy when they fail', () => {
    expect(step('Run migrations on Neon')).not.toMatch(/continue-on-error/);
    expect(step('Seed catalog on Neon')).not.toMatch(/continue-on-error/);
  });
});
