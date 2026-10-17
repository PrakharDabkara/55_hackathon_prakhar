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
});
