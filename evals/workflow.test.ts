import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const yml = readFileSync(new URL('../.github/workflows/evals.yml', import.meta.url), 'utf8');
const block = (name: string) =>
  new RegExp(`^  ${name}:\\n((?:    .*\\n|\\n)+)`, 'm').exec(yml)?.[1] ?? '';

describe('.github/workflows/evals.yml triggers', () => {
  const prTypes = /types:\s*\[([^\]]*)\]/.exec(block('pull_request'))?.[1] ?? '';
  const types = prTypes.split(',').map((t) => t.trim());

  it('starts when the evals label is added and on every push to a labelled pull request', () => {
    expect(types).toContain('labeled');
    expect(types).toContain('synchronize');
  });

  it('also starts a pull request that is opened or reopened already carrying the label', () => {
    expect(types).toContain('opened');
    expect(types).toContain('reopened');
  });

  it('starts a draft that is marked ready while it carries the label', () => {
    expect(types).toContain('ready_for_review');
  });

  it('runs the job only for the evals label, and only on a pull request that carries it', () => {
    expect(yml).toContain("contains(github.event.pull_request.labels.*.name, 'evals')");
    expect(yml).toContain("github.event.label.name == 'evals'");
  });

  it('keeps the schedule and the manual trigger', () => {
    expect(yml).toMatch(/schedule:/);
    expect(yml).toMatch(/workflow_dispatch:/);
  });
});
