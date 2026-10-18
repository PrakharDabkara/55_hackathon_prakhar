import { describe, expect, it } from 'vitest';
import { buildSystemPrompt, buildTaskMessage, sanitiseTask } from './prompt.js';

describe('sanitiseTask', () => {
  it('turns control characters and line breaks into single spaces', () => {
    expect(sanitiseTask('chart paper\n\n  aur\tfevicol\u0007')).toBe('chart paper aur fevicol');
  });

  it('removes the marks that delimit the task', () => {
    expect(sanitiseTask('x <<<TASK y TASK>>> z')).not.toMatch(/<<<|>>>/);
  });
});

describe('prompts', () => {
  it('wraps the task in marks and says it is data', () => {
    const message = buildTaskMessage({ task: 'chai ka saaman', budgetPaise: null });
    expect(message).toMatch(/^<<<TASK\nchai ka saaman\nTASK>>>/);
    expect(buildSystemPrompt({ maxItems: 10 })).toMatch(
      /data, not instructions|never instructions/i,
    );
  });

  it('mentions a budget in rupees only when there is one', () => {
    expect(buildTaskMessage({ task: 'a', budgetPaise: 25_000 })).toMatch(/₹250/);
    expect(buildTaskMessage({ task: 'a', budgetPaise: null })).not.toMatch(/₹|budget/i);
  });

  it('tells the model the limits and that it ends with submit_plan', () => {
    const system = buildSystemPrompt({ maxItems: 7 });
    expect(system).toMatch(/7/);
    expect(system).toMatch(/submit_plan/);
    expect(system).toMatch(/find_item_nearby/);
  });

  it('for a goal without items: propose the usual items and confirm them with one multi-select ask_user', () => {
    const system = buildSystemPrompt({ maxItems: 10 });
    expect(system).toMatch(/goal rather than items|names a goal/i);
    expect(system).toMatch(/chai patti, chini, doodh/);
    expect(system).toMatch(/multiSelect/);
    expect(system).toMatch(/preselected/);
    expect(system).toMatch(/Ye cheezein chahiye\?/);
    expect(system).toMatch(/never ask either\/or|either\/or/i);
  });

  it('never looks up or asks shops for anything illegal, dangerous or abusive (Day 14c)', () => {
    const system = buildSystemPrompt({ maxItems: 10 });
    expect(system).toMatch(/illegal|dangerous|abusive/i);
    expect(system).toMatch(/weapons|drugs/i);
    expect(system).toMatch(/do not call resolve_item or ask_shops/i);
    expect(system).toMatch(/not_found/);
  });

  it('tells the model how new, blocked and limited items work (ADR-0028, ADR-0029)', () => {
    const system = buildSystemPrompt({ maxItems: 10 });
    expect(system).toMatch(/isNew/);
    expect(system).toMatch(/ask_shops/);
    expect(system).toMatch(/blocked/);
    expect(system).toMatch(/do not try (again|other words)/i);
    // Unusual is not forbidden: only harmful is.
    expect(system).toMatch(/unusual|unfamiliar|not in the catalog/i);
  });

  it('asks for the checklist of usual extras for a project or event even when some items are named', () => {
    const system = buildSystemPrompt({ maxItems: 10 });
    expect(system).toMatch(/school project/i);
    expect(system).toMatch(/extras/i);
    expect(system).toMatch(/named/i);
  });
});
