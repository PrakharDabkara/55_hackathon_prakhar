import { describe, expect, it } from 'vitest';
import { checklistFor } from './executor.js';

// ADR-0049 rule 2 (a goal with no named item) pre-ticks the agent's list; ADR-0053 rule 3 (the
// customer named items) offers the agent's extras unticked.
describe('checklistFor', () => {
  it('rule 2 is unchanged: for a goal the whole list is pre-ticked', () => {
    expect(checklistFor('poha banane ka saaman', ['chini', 'namak'])).toEqual({
      question: 'Which of these do you need?',
      options: ['chini', 'namak'],
      multiSelect: true,
      preselected: [0, 1],
    });
    expect(checklistFor('chini, namak', ['namak', 'atta'])).toMatchObject({
      options: ['chini', 'namak', 'atta'],
      preselected: [0, 1, 2],
    });
  });

  it('with extrasTicked false the named items come first and ticked, the extras unticked', () => {
    expect(
      checklistFor('bachche ke project ke liye bead dazzling kit, chart paper', ['glue stick'], {
        extrasTicked: false,
      }),
    ).toEqual({
      question: 'Which of these do you need?',
      options: ['bead dazzling kit', 'chart paper', 'glue stick'],
      multiSelect: true,
      preselected: [0, 1],
    });
  });

  it('does not repeat a named item the agent also wanted, and caps the list at 8', () => {
    const wanted = ['chart paper', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8'];
    const q = checklistFor('bead kit, chart paper', wanted, { extrasTicked: false });
    expect(q.options).toEqual(['bead kit', 'chart paper', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6']);
    expect(q.preselected).toEqual([0, 1]);
  });
});
