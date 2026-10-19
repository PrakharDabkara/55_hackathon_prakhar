import type { Label } from '../i18n/strings.js';

const DEVANAGARI = /[ऀ-ॿ]/;

/**
 * An item's name as a big line with the English under it. A customer-made item has no Hindi name
 * (its "Hindi" name is the words it was typed with), so it shows once, never "Kesar Kesar".
 */
export function itemWords(item: { nameEn: string; nameHi: string }): Label {
  return DEVANAGARI.test(item.nameHi)
    ? { main: item.nameHi, sub: item.nameEn }
    : { main: item.nameEn };
}
