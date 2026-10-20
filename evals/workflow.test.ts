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

describe('.github/workflows/evals.yml: the agent-evals job (Day 14c)', () => {
  const job = block('agent-evals');

  it('exists, on the RUNNER variable (else ubuntu-latest), in the evals environment, with a timeout', () => {
    expect(job).not.toBe('');
    expect(job).toMatch(/runs-on:\s*\$\{\{ vars\.RUNNER \|\| 'ubuntu-latest' \}\}/);
    expect(job).toMatch(/environment:\s*evals/);
    expect(job).toMatch(/timeout-minutes:\s*\d+/);
  });

  it('runs only for the agent-evals label on a pull request, or by hand; never on the schedule', () => {
    expect(job).toContain("contains(github.event.pull_request.labels.*.name, 'agent-evals')");
    expect(job).toContain("github.event.label.name == 'agent-evals'");
    expect(job).toMatch(/github\.event_name\s*!=\s*'schedule'/);
  });

  it('is started by hand with the set and the model as inputs, and the resolve job stays out of it', () => {
    const dispatch = block('workflow_dispatch');
    expect(dispatch).toMatch(/set:/);
    expect(dispatch).toMatch(/options:\s*\[dev, holdout\]/);
    expect(dispatch).toMatch(/model:/);
    expect(dispatch).toMatch(/options:\s*\[primary, fallback\]/);
    expect(block('evals')).toMatch(/inputs\.suite/);
  });

  it('needs the key, calls the runner with the gate, uploads the report, and shares the quota group', () => {
    expect(job).toMatch(/GEMINI_API_KEY/);
    expect(job).toMatch(/npm run eval:errand/);
    expect(job).toMatch(/upload-artifact/);
    expect(yml).toMatch(/concurrency:\s*\n\s*group: evals/);
  });

  it('does not let the resolve job start for an agent-evals label', () => {
    expect(yml).toContain("github.event.label.name == 'evals'");
  });
});

describe('the workflows and caches on a self-hosted runner', () => {
  const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const npmCache = "cache: ${{ runner.environment == 'github-hosted' && 'npm' || '' }}";

  it('caches ~/.npm only on GitHub-hosted runners, in every job that sets up node', () => {
    for (const [name, text] of [
      ['ci.yml', ci],
      ['evals.yml', yml],
    ] as const) {
      const setups = text.match(/actions\/setup-node@/g)?.length ?? 0;
      const guarded = text.split(npmCache).length - 1;
      expect(guarded, `${name}: every setup-node`).toBe(setups);
      expect(text).not.toMatch(/cache: npm\s*$/m);
    }
  });

  it('never saves or restores an actions/cache on a self-hosted runner', () => {
    const steps = yml.split(/^ {6}- /m).filter((step) => step.includes('uses: actions/cache/'));
    expect(steps.length).toBeGreaterThan(0);
    for (const step of steps) expect(step).toContain("runner.environment != 'self-hosted'");
  });

  it('keeps the catalog embeddings in a fixed local directory on a self-hosted runner', () => {
    expect(yml).toContain('$HOME/.cache/kahanmilega-evals');
    expect(yml.match(/if: runner\.environment == 'self-hosted'/g)?.length).toBeGreaterThanOrEqual(
      2,
    );
  });
});
