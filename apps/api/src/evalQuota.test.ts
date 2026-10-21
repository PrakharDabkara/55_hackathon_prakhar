import { describe, expect, it, vi } from 'vitest';
import { createQuotaStop } from './evalQuota.js';

function setup() {
  const errors: string[] = [];
  const summary: string[] = [];
  const exit = vi.fn();
  const stop = createQuotaStop({
    title: 'Resolve evals',
    error: (l) => errors.push(l),
    summary: (t) => summary.push(t),
    cleanup: async () => undefined,
    exit,
  });
  return { stop, errors, summary, exit };
}

describe('the QUOTA_EXHAUSTED stop', () => {
  it('prints a QUOTA_EXHAUSTED line, writes the summary and exits with 3', async () => {
    const s = setup();
    s.stop('the daily quota is used up (RESOURCE_EXHAUSTED, per-day limit)');
    await vi.waitFor(() => expect(s.exit).toHaveBeenCalledWith(3));
    expect(s.errors[0]).toContain('QUOTA_EXHAUSTED');
    expect(s.summary[0]).toContain('QUOTA_EXHAUSTED');
    expect(s.summary[0]).toContain('Resolve evals');
  });

  it('acts once, however many calls report it', async () => {
    const s = setup();
    s.stop('a');
    s.stop('b');
    await vi.waitFor(() => expect(s.exit).toHaveBeenCalled());
    expect(s.exit).toHaveBeenCalledTimes(1);
    expect(s.errors).toHaveLength(1);
  });
});
