/**
 * Shop and item categories. Keep in step with the checks in migrations 003, 004, 013 and 014.
 * `grocery` is the kirana (the default for a shop); `personal_care` covers cosmetics. The last five
 * came with the open catalog (ADR-0028).
 */
export const CATEGORIES = [
  'grocery',
  'hardware',
  'electrical',
  'stationery',
  'mobile_accessories',
  'household_kitchen',
  'personal_care',
  'general_store',
  'dairy',
  'sabzi_fruit',
  'pooja',
  'medical',
  'bakery_sweets',
] as const;

export type Category = (typeof CATEGORIES)[number];

export const isCategory = (value: unknown): value is Category =>
  typeof value === 'string' && (CATEGORIES as readonly string[]).includes(value);

/**
 * What a general store also takes requests for, besides its own category: the everyday things people
 * expect to find there (S-06). Other shops are asked about their own categories only.
 */
export const GENERAL_STORE_ALSO_TAKES = [
  'household_kitchen',
  'personal_care',
  'stationery',
] as const;

/** The categories a shop is asked about: its own, plus what a general store also takes. Own order first. */
export function coveredCategories(shopCategories: readonly string[]): string[] {
  if (!shopCategories.includes('general_store')) return [...shopCategories];
  return [...new Set([...shopCategories, ...GENERAL_STORE_ALSO_TAKES])];
}
