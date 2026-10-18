import { readFileSync } from 'node:fs';
import { z } from 'zod';

/** What the customer does when the agent asks (scripted, so a run is repeatable). */
export const answerSchema = z.object({
  /** Multi-select question: "preselected" ticks what the agent preselected, or a list of indexes. */
  selected: z.union([z.literal('preselected'), z.array(z.number().int().min(0))]).optional(),
  /** Untick any option whose text contains one of these words. */
  untick: z.array(z.string().min(1)).optional(),
  /** The "Kuch aur?" text of a multi-select, or the typed answer of any question. */
  add: z.string().min(1).optional(),
  /** Single-choice question: the index of the option to tap. */
  pick: z.number().int().min(0).optional(),
  text: z.string().min(1).optional(),
});
export type Answer = z.infer<typeof answerSchema>;

const status = z.enum(['confirmed', 'likely', 'not_found']);

/**
 * One errand for the agent evals. Items are catalog slugs. Under "expect":
 * - `state` lists the end states that count as right ("REJECTED" = the task was refused at creation);
 * - `required` slugs must be in the plan, `requiredAny` needs one slug of each group,
 *   `forbidden` slugs (wrong matches) must not be, `noItems` means no plan item may be a catalog item;
 * - `found` slugs must be confirmed or likely, `status` fixes the status of a slug;
 * - `askUser` says whether the agent must, must not, or may ask the customer;
 * - `noShopAsk`: no shop may be asked about this task;
 * - `noNewItems`: no item may be added to the catalog for it (a harmful task);
 * - `newItemsToMatchingShops`: items the errand adds are asked only of shops of their kind.
 * Items outside the catalog are never asserted "not found": since the catalog opened (ADR-0028) a
 * real product becomes an item, so the cases hold only what stays true either way.
 */
export const errandCaseSchema = z.object({
  id: z.string().min(2),
  kind: z.string().min(2),
  task: z.string().min(1).max(500),
  location: z.object({ lat: z.number(), lng: z.number() }).optional(),
  /** Learned stock before the errand: none, a few shops, or three or more for every item. */
  stock: z.enum(['none', 'sparse', 'rich']),
  /** How the pinged shops behave: all answer, none, every other one, or all answer late. */
  shops: z.enum(['all', 'none', 'partial', 'slow']),
  answers: z.array(answerSchema).optional(),
  injection: z.boolean().default(false),
  expect: z.object({
    state: z.array(z.string().min(1)).min(1),
    required: z.array(z.string()).optional(),
    requiredAny: z.array(z.array(z.string()).min(1)).optional(),
    forbidden: z.array(z.string()).optional(),
    found: z.array(z.string()).optional(),
    status: z.record(z.string(), status).optional(),
    noItems: z.boolean().optional(),
    askUser: z.enum(['must', 'never', 'any']),
    noShopAsk: z.boolean().optional(),
    noNewItems: z.boolean().optional(),
    newItemsToMatchingShops: z.boolean().optional(),
  }),
});
export type ErrandCase = z.infer<typeof errandCaseSchema>;

/** The demo location: Rajwada, Indore. The synthetic shops are around it. */
export const DEMO_LOCATION = { lat: 22.7196, lng: 75.8577 };

export function loadErrandCases(file: string): ErrandCase[] {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line, i) => {
      const parsed = errandCaseSchema.safeParse(JSON.parse(line));
      if (!parsed.success) throw new Error(`${file} line ${i + 1}: ${parsed.error.message}`);
      return parsed.data;
    });
}
