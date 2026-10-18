import { CATEGORIES, type Category } from '@kahanmilega/shared';

export interface GenerateInput {
  count: number;
  centre: { lat: number; lng: number };
  radiusM: number;
  seed: number;
  /** Make shops of these categories only. Default: the realistic mix of all eight. */
  categories?: readonly Category[] | undefined;
}

export interface SimShopSpec {
  name: string;
  phone: string;
  lat: number;
  lng: number;
  categories: Category[];
}

/** Small seeded generator (mulberry32): the same seed always gives the same sequence. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** How common each kind of shop is on a typical Indian street. */
const WEIGHTS: [Category, number][] = [
  ['grocery', 28],
  ['general_store', 12],
  ['household_kitchen', 8],
  ['stationery', 10],
  ['hardware', 9],
  ['electrical', 7],
  ['mobile_accessories', 5],
  ['personal_care', 5],
  ['dairy', 5],
  ['sabzi_fruit', 5],
  ['pooja', 5],
  ['medical', 4],
  ['bakery_sweets', 4],
];

const SURNAMES = [
  'Sharma',
  'Gupta',
  'Verma',
  'Agrawal',
  'Jain',
  'Patel',
  'Mishra',
  'Yadav',
  'Joshi',
  'Chouhan',
  'Soni',
  'Rathore',
  'Tiwari',
  'Pandey',
  'Khandelwal',
  'Maheshwari',
  'Bhatia',
  'Malhotra',
  'Singh',
  'Kumar',
  'Dubey',
  'Saxena',
  'Trivedi',
  'Sethi',
  'Rajput',
  'Patidar',
  'Garg',
  'Mehta',
  'Shah',
  'Bansal',
];
const GODS = [
  'Balaji',
  'Ganesh',
  'Shiv',
  'Sai',
  'Om',
  'Radhe',
  'Krishna',
  'Laxmi',
  'Annapurna',
  'Hanuman',
  'Jai Mata Di',
  'Kailash',
  'Narmada',
  'Ambey',
  'Mahakal',
];

const TEMPLATES: Record<Category, string[]> = {
  grocery: [
    '{s} Kirana Store',
    '{s} General & Kirana',
    'Shree {g} Provision Store',
    '{s} Super Mart',
    'New {s} Kirana',
    '{g} Kirana Bhandar',
    '{s} Dairy & Grocery',
  ],
  hardware: [
    '{s} Hardware',
    '{g} Hardware & Paints',
    'New {s} Tools & Hardware',
    'Shree {g} Hardware Store',
  ],
  electrical: ['{s} Electricals', '{g} Electrical & Lighting', 'New {s} Electric Store'],
  stationery: ['{s} Stationers', '{g} Book Depot & Stationery', 'New {s} Stationery Mart'],
  mobile_accessories: ['{s} Mobile Accessories', '{g} Mobile Hub', 'New {s} Mobile Point'],
  household_kitchen: ['{s} Home Needs', '{g} Kitchenware', '{s} Steel & Plastics'],
  personal_care: ['{s} Cosmetics & General', '{g} Beauty & Personal Care', '{s} Ladies Corner'],
  general_store: ['{s} General Store', 'Shree {g} General Stores', 'New {s} Gift & General'],
  dairy: ['{s} Dairy', '{g} Doodh Dairy', 'Shree {g} Milk Parlour'],
  sabzi_fruit: ['{s} Fruits & Vegetables', '{g} Sabzi Bhandar', 'New {s} Fresh Fruits'],
  pooja: ['{g} Pooja Samagri', '{s} Pooja Store', 'Shree {g} Puja Bhandar'],
  medical: ['{s} Medical Store', '{g} Medicos', 'New {s} Medical & General'],
  bakery_sweets: ['{s} Bakery', '{g} Sweets & Namkeen', 'New {s} Bakers & Sweets'],
};

/** Where a repeated name is told apart: a real street has two "Book Depot"s in different localities. */
const LOCALITIES = [
  'Rajwada',
  'Palasia',
  'Vijay Nagar',
  'Bhawarkuan',
  'Sapna Sangeeta',
  'Annapurna Road',
  'Geeta Bhawan',
  'Navlakha',
  'Sarafa',
  'Chhoti Gwaltoli',
  'Nanda Nagar',
  'Saket',
  'Tilak Nagar',
  'Bengali Square',
  'MG Road',
  'Khajrana',
];

/** II, III, IV...: a last resort that keeps a name letters-only. */
function roman(n: number): string {
  const parts: [number, string][] = [
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I'],
  ];
  let out = '';
  for (const [value, letters] of parts)
    while (n >= value) {
      out += letters;
      n -= value;
    }
  return out;
}

const pick = <T>(list: readonly T[], next: () => number): T =>
  list[Math.floor(next() * list.length)] as T;

function pickCategory(next: () => number, allowed: readonly Category[], not?: Category): Category {
  const options = WEIGHTS.filter(([c]) => c !== not && allowed.includes(c));
  let roll = next() * options.reduce((sum, [, w]) => sum + w, 0);
  for (const [category, weight] of options) {
    roll -= weight;
    if (roll < 0) return category;
  }
  return (options[0] as [Category, number])[0];
}

const METRES_PER_DEGREE = 111_320;

/**
 * Plausible shops around a point: a realistic mix of the 13 categories, Indian-style names, spread
 * evenly over the disc, each with a phone from a reserved block (+9160xxxxxxxx) that real users do
 * not use. Pure and deterministic: the same input always gives the same shops.
 */
export function generateShops({
  count,
  centre,
  radiusM,
  seed,
  categories: allowed = CATEGORIES,
}: GenerateInput): SimShopSpec[] {
  const next = rng(seed);
  const phones = new Set<string>();
  const taken = new Set<string>();
  const shops: SimShopSpec[] = [];

  while (shops.length < count) {
    const first = pickCategory(next, allowed);
    const wantsSecond = next() < 0.25 && allowed.length > 1;
    const categories: Category[] = wantsSecond
      ? [first, pickCategory(next, allowed, first)]
      : [first];
    let name = pick(TEMPLATES[first], next)
      .replace('{s}', pick(SURNAMES, next))
      .replace('{g}', pick(GODS, next));
    // Names are unique. A repeat gets a locality, and if that repeats too, a number.
    if (taken.has(name)) name = `${name} - ${pick(LOCALITIES, next)}`;
    for (let n = 2; taken.has(name); n++) name = `${name.replace(/ [IVX]+$/, '')} ${roman(n)}`;

    // sqrt makes the shops uniform over the disc's area instead of bunched at the centre.
    const distance = radiusM * 0.999 * Math.sqrt(next());
    const angle = next() * 2 * Math.PI;
    const lat = centre.lat + (distance * Math.cos(angle)) / METRES_PER_DEGREE;
    const lng =
      centre.lng +
      (distance * Math.sin(angle)) / (METRES_PER_DEGREE * Math.cos((centre.lat * Math.PI) / 180));

    const phone = `+9160${String(Math.floor(next() * 1e8)).padStart(8, '0')}`;
    if (phones.has(phone)) continue;
    phones.add(phone);
    taken.add(name);

    shops.push({
      name,
      phone,
      lat: Math.round(lat * 1e6) / 1e6,
      lng: Math.round(lng * 1e6) / 1e6,
      categories,
    });
  }
  return shops;
}
