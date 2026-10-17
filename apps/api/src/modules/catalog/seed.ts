import { withTransaction, type Database } from '../../db/queryable.js';
import seedJson from './catalog.seed.json' with { type: 'json' };
import {
  catalogVersionOf,
  categoriesOf,
  checkCatalog,
  defaultsFor,
  parseCatalog,
  termsFor,
  type SeedCatalog,
} from './seedData.js';
import { PRODUCT_FORMS } from './productForm.js';

/**
 * Identifies this catalog file and the product-form list. Cached AI answers carry it, so a changed
 * catalog or form list retires them.
 */
export const CATALOG_VERSION = catalogVersionOf({ seed: seedJson, forms: PRODUCT_FORMS });

/** The catalog file that ships with the API. */
export const loadSeedCatalog = (): SeedCatalog => parseCatalog(seedJson);

/**
 * Makes the database match the catalog file. Safe to run any number of times: items are keyed by
 * slug and terms by their text, a term that moved follows its new item, and a term removed from
 * the file is removed from the seeded items.
 */
export async function seedCatalog(
  db: Database,
  catalog: SeedCatalog,
): Promise<{ items: number; terms: number }> {
  checkCatalog(catalog);
  return withTransaction(db, async (tx) => {
    const { rows } = await tx.query<{ id: string; slug: string }>(
      `INSERT INTO items (slug, name_en, name_hi, category, categories, ref_price_paise)
       SELECT s, n, h, c, string_to_array(cs, ','), p
         FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::int[])
              AS t(s, n, h, c, cs, p)
       ON CONFLICT (slug) DO UPDATE
         SET name_en = EXCLUDED.name_en, name_hi = EXCLUDED.name_hi, category = EXCLUDED.category,
             categories = EXCLUDED.categories, ref_price_paise = EXCLUDED.ref_price_paise
       RETURNING id, slug`,
      [
        catalog.items.map((i) => i.slug),
        catalog.items.map((i) => i.nameEn),
        catalog.items.map((i) => i.nameHi),
        catalog.items.map((i) => i.category),
        catalog.items.map((i) => categoriesOf(i).join(',')),
        catalog.items.map((i) => i.refPricePaise),
      ],
    );
    const idBySlug = new Map(rows.map((r) => [r.slug, r.id]));

    const terms: string[] = [];
    const itemIds: string[] = [];
    for (const item of catalog.items) {
      for (const term of termsFor(item)) {
        terms.push(term);
        itemIds.push(idBySlug.get(item.slug) as string);
      }
    }
    await tx.query(
      `INSERT INTO item_synonyms (term, item_id)
       SELECT * FROM unnest($1::text[], $2::uuid[])
       ON CONFLICT (term) DO UPDATE SET item_id = EXCLUDED.item_id`,
      [terms, itemIds],
    );
    await tx.query(
      `DELETE FROM item_synonyms WHERE item_id = ANY($1::uuid[]) AND term <> ALL($2::text[])`,
      [[...idBySlug.values()], terms],
    );

    const defaultTerms: string[] = [];
    const defaultItems: string[] = [];
    for (const item of catalog.items) {
      for (const term of defaultsFor(item)) {
        defaultTerms.push(term);
        defaultItems.push(idBySlug.get(item.slug) as string);
      }
    }
    await tx.query(
      `INSERT INTO item_defaults (term, item_id)
       SELECT * FROM unnest($1::text[], $2::uuid[])
       ON CONFLICT (term) DO UPDATE SET item_id = EXCLUDED.item_id`,
      [defaultTerms, defaultItems],
    );
    await tx.query(
      `DELETE FROM item_defaults WHERE item_id = ANY($1::uuid[]) AND term <> ALL($2::text[])`,
      [[...idBySlug.values()], defaultTerms],
    );
    return { items: catalog.items.length, terms: terms.length };
  });
}
