import { describe, expect, it } from 'vitest';
import { ERRAND_EVENTS, ERRAND_STATES, errandTransition } from './stateMachine.js';

describe('errand state machine', () => {
  it('knows the three states of Day 12', () => {
    expect([...ERRAND_STATES]).toEqual(['PLANNING', 'PLAN_READY', 'FAILED']);
    expect([...ERRAND_EVENTS]).toEqual(['PLAN_SUBMITTED', 'RUN_FAILED']);
  });

  it('PLANNING moves to PLAN_READY on a submitted plan and to FAILED when the run gives up', () => {
    expect(errandTransition('PLANNING', 'PLAN_SUBMITTED')).toEqual({ ok: true, to: 'PLAN_READY' });
    expect(errandTransition('PLANNING', 'RUN_FAILED')).toEqual({ ok: true, to: 'FAILED' });
  });

  it('PLAN_READY and FAILED are final', () => {
    for (const state of ['PLAN_READY', 'FAILED'] as const)
      for (const event of ERRAND_EVENTS)
        expect(errandTransition(state, event), `${state} ${event}`).toMatchObject({ ok: false });
  });
});
