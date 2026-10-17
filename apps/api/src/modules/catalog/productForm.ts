/**
 * Product forms (ADR-0021 amendment, Day 14c). "chandan itr" is attar, a perfume; "sandalwood
 * powder" is a different product that shares the word chandan. A form word in the query that the
 * item's own name contradicts rules that item out at every resolve step, so the nearest item is
 * never a fallback. The list is short and curated: each group is one form in the spellings
 * customers use (Latin and Devanagari). Add a group only for a form where two catalog items can
 * share the rest of the words.
 */
export const PRODUCT_FORMS: Record<string, string[]> = {
  attar: ['itr', 'ittar', 'attar', 'इत्र'],
  oil: ['tel', 'oil', 'तेल'],
  powder: ['powder', 'churan', 'पाउडर', 'चूर्ण'],
  soap: ['sabun', 'soap', 'साबुन'],
  incense: ['agarbatti', 'agarbathi', 'incense', 'अगरबत्ती'],
  pickle: ['pickle', 'achaar', 'achar', 'अचार'],
};

const FORM_OF_WORD = new Map(
  Object.entries(PRODUCT_FORMS).flatMap(([form, words]) => words.map((w) => [w, form] as const)),
);

const WORDS = /[^\p{L}\p{M}\p{N}]+/u;

/** The forms named by whole words of the text. */
export function formsOf(text: string): Set<string> {
  const forms = new Set<string>();
  for (const word of text.toLowerCase().split(WORDS)) {
    const form = FORM_OF_WORD.get(word);
    if (form) forms.add(form);
  }
  return forms;
}

/**
 * True when the query names a form and the item's names name a different one (and none of the
 * query's). No opinion when either side names no form.
 */
export function formConflict(query: string, itemNames: string[]): boolean {
  const wanted = formsOf(query);
  if (wanted.size === 0) return false;
  const has = new Set(itemNames.flatMap((name) => [...formsOf(name)]));
  if (has.size === 0) return false;
  return ![...wanted].some((form) => has.has(form));
}
