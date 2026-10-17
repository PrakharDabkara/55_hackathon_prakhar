import { createHash } from 'node:crypto';
import { CATEGORIES, type Category } from '@kahanmilega/shared';
import { z } from 'zod';
import { normaliseQuery } from './normalise.js';

const item = z.object({
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  /** The primary category: the kind of shop that most often carries the item. */
  category: z.enum(CATEGORIES),
  /** Other kinds of shop that really carry it (fevicol: hardware, and stationery too). */
  extraCategories: z.array(z.enum(CATEGORIES)).max(3).optional(),
  nameEn: z.string().min(1),
  nameHi: z.string().min(1),
  /** Typical shelf price of the usual pack, in integer paise. AI-estimated; see the file note. */
  refPricePaise: z.number().int().min(100).max(5_000_000),
  synonyms: z.array(z.string().min(1)).min(3).max(8),
  /** Generic words that mean this item as the usual choice of a family ("pen" → ball pen). */
  defaultFor: z.array(z.string().min(1)).max(4).optional(),
});

const catalogSchema = z.object({
  version: z.number().int().min(1),
  note: z.string(),
  items: z.array(item).min(1),
});

export type SeedCatalog = z.infer<typeof catalogSchema>;
export type SeedItem = z.infer<typeof item>;

/** A short fingerprint of the catalog file. A change to the file changes it, which retires cached answers. */
export const catalogVersionOf = (data: unknown): string =>
  createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0, 16);

export const parseCatalog = (data: unknown): SeedCatalog => catalogSchema.parse(data);

/** Every lookup term of an item: its two names and its synonyms, normalised, without repeats. */
export function termsFor(i: SeedItem): string[] {
  const terms = [i.nameEn, i.nameHi, ...i.synonyms].map((t) => normaliseQuery(t).text);
  return [...new Set(terms.filter(Boolean))];
}

/** The generic words an item is the default for, normalised. */
/** Every kind of shop that carries the item, the primary first. */
export const categoriesOf = (i: SeedItem): Category[] => [i.category, ...(i.extraCategories ?? [])];

export const defaultsFor = (i: SeedItem): string[] => [
  ...new Set((i.defaultFor ?? []).map((t) => normaliseQuery(t).text).filter(Boolean)),
];

/** Throws on a duplicate slug, a term that is empty or a quantity, or a term two items share. */
export function checkCatalog(catalog: SeedCatalog): void {
  const slugs = new Set<string>();
  const owner = new Map<string, string>();
  for (const i of catalog.items) {
    if (slugs.has(i.slug)) throw new Error(`duplicate slug: ${i.slug}`);
    slugs.add(i.slug);
    if (new Set(categoriesOf(i)).size !== categoriesOf(i).length)
      throw new Error(`${i.slug}: a category is listed twice`);
    for (const raw of [i.nameEn, i.nameHi, ...i.synonyms]) {
      const { text, quantity } = normaliseQuery(raw);
      if (!text || quantity) throw new Error(`${i.slug}: term "${raw}" is empty or a quantity`);
    }
    for (const term of termsFor(i)) {
      const other = owner.get(term);
      if (other && other !== i.slug) {
        throw new Error(`term "${term}" belongs to both ${other} and ${i.slug}`);
      }
      owner.set(term, i.slug);
    }
  }
  const defaultOwner = new Map<string, string>();
  for (const i of catalog.items) {
    for (const term of defaultsFor(i)) {
      if (owner.has(term)) throw new Error(`default "${term}" of ${i.slug} is already a synonym`);
      const other = defaultOwner.get(term);
      if (other) throw new Error(`default "${term}" is claimed by both ${other} and ${i.slug}`);
      defaultOwner.set(term, i.slug);
    }
  }
}
