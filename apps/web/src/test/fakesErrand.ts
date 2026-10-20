import type { ErrandPlan, ErrandQuestion, PlanItem, PlanVariant } from '../lib/seekerApi.js';
import { errandPlan, planItem } from './fakes.js';

export { errandPlan, errandView, planItem } from './fakes.js';

/** The agent's checklist: three items it suggests, two it does not. The text is model-written. */
export const listQuestion: ErrandQuestion = {
  question: 'Ye cheezein chahiye?',
  options: ['tea leaves', 'sugar', 'milk', 'ginger', 'cardamom'],
  multiSelect: true,
  preselected: [0, 1, 2],
};

/** A free-form question with answer chips. */
export const choiceQuestion: ErrandQuestion = {
  question: 'Which tea?',
  options: ['Dust tea', 'Leaf tea'],
};

/** An item whose shop delivers, on pickup unless told otherwise. */
export const deliveringItem = (over: Partial<PlanItem> = {}): PlanItem => ({
  ...planItem({ text: 'chai patti', itemName: 'tea leaves', pricePaise: 9900 }),
  delivery: { feePaise: 3000, minutes: 45 },
  mode: 'pickup',
  ...over,
});

/** An item nobody has. */
export const lostItem = (over: Partial<PlanItem> = {}): PlanItem => ({
  ...planItem({ text: 'unicorn', itemName: null, itemId: null }),
  status: 'not_found',
  shopId: null,
  shopName: null,
  pricePaise: null,
  freshness: null,
  distanceM: null,
  ...over,
});

/** Both variants replaced by the same one (so there is nothing to compare). */
export function samePlan(variant?: Partial<PlanVariant>): ErrandPlan {
  const base = errandPlan();
  const kam = { ...base.plans.kam_dukaan, ...variant };
  return errandPlan({ plans: { kam_dukaan: kam, sasta: { ...kam, kind: 'sasta' } } });
}

/** The recommended variant gets these items; the other keeps its own. */
export function planWithItems(items: PlanItem[], over: Partial<PlanVariant> = {}): ErrandPlan {
  return samePlan({ items, ...over });
}
