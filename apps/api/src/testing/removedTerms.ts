/**
 * Terms taken out of the seed catalog because each could mean more than one item.
 * A search for any of them on its own must resolve to nothing (the user can then be asked).
 */
export const REMOVED_TERMS = [
  // Asked for by name
  'clip',
  'clips',
  'कटर',
  'switch board',
  // Found in the audit: one generic word, several plausible items
  'adapter',
  'bag',
  'band',
  'blade',
  'bolt',
  'botal',
  'cream',
  'dabba',
  'dabbe',
  'drill',
  'fan',
  'gum',
  'holder',
  'masala',
  'nail',
  'napkin',
  'pads',
  'paint',
  'pan',
  'paste',
  'pen',
  'pin',
  'plug',
  'powder',
  'rubber',
  'slice',
  'switch',
  'wrench',
  'पाउडर',
  'प्लग',
  'रबर',
  'स्विच',
] as const;
