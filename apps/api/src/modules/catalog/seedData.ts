import { CATEGORIES } from '@kahanmilega/shared';
import { z } from 'zod';
import { normaliseQuery } from './normalise.js';

const item = z.object({
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  category: z.enum(CATEGORIES),
  nameEn: z.string().min(1),
  nameHi: z.string().min(1),
  synonyms: z.array(z.string().min(1)).min(3).max(6),
});

const catalogSchema = z.object({
  version: z.number().int().min(1),
  note: z.string(),
  items: z.array(item).min(1),
});

export type SeedCatalog = z.infer<typeof catalogSchema>;
export type SeedItem = z.infer<typeof item>;

export const parseCatalog = (data: unknown): SeedCatalog => catalogSchema.parse(data);

/** Every lookup term of an item: its two names and its synonyms, normalised, without repeats. */
export function termsFor(i: SeedItem): string[] {
  const terms = [i.nameEn, i.nameHi, ...i.synonyms].map((t) => normaliseQuery(t).text);
  return [...new Set(terms.filter(Boolean))];
}

/** Throws on a duplicate slug, a term that is empty or a quantity, or a term two items share. */
export function checkCatalog(catalog: SeedCatalog): void {
  const slugs = new Set<string>();
  const owner = new Map<string, string>();
  for (const i of catalog.items) {
    if (slugs.has(i.slug)) throw new Error(`duplicate slug: ${i.slug}`);
    slugs.add(i.slug);
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
}
