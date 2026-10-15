/** Shop categories at launch. Keep in step with the `shops_categories_valid` check in migration 003. */
export const CATEGORIES = [
  'grocery',
  'hardware',
  'electrical',
  'stationery',
  'mobile_accessories',
  'household_kitchen',
  'personal_care',
  'general_store',
] as const;

export type Category = (typeof CATEGORIES)[number];

export const isCategory = (value: unknown): value is Category =>
  typeof value === 'string' && (CATEGORIES as readonly string[]).includes(value);
