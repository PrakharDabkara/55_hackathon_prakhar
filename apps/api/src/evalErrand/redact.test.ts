import { describe, expect, it } from 'vitest';
import { renderErrandMarkdown, summariseErrand, type CaseResult } from './score.js';

const failing = {
  id: 'h07',
  kind: 'plain',
  errored: null,
  failed: ['wrong_item'],
  success: false,
  state: 'PLAN_READY',
  missing: ['secret-slug'],
  planSlugs: ['other-slug'],
} as unknown as CaseResult;

describe('the errand report for a holdout', () => {
  it('lists failing case ids for the dev set', () => {
    const md = renderErrandMarkdown([
      { model: 'm', set: 'dev', summary: summariseErrand([failing]), results: [failing] },
    ]);
    expect(md).toContain('h07');
  });

  it('with aggregateOnly it shows numbers and no case id, slug or reason', () => {
    const md = renderErrandMarkdown(
      [{ model: 'm', set: 'holdout', summary: summariseErrand([failing]), results: [failing] }],
      { aggregateOnly: true },
    );
    expect(md).not.toContain('h07');
    expect(md).not.toContain('secret-slug');
    expect(md).not.toContain('other-slug');
    expect(md).not.toContain('Failing cases');
    expect(md).toContain('| m | holdout |');
  });
});
