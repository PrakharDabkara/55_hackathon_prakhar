import type { Category } from '@askbuy/shared';

/** The demo place everything is laid out around: Vijay Nagar, Indore. */
export const DEMO_PLACE = { lat: 22.7196, lng: 75.8577, label: 'Vijay Nagar, Indore' } as const;

const M_PER_DEG_LAT = 111_320;
/** A point this many metres east and north of the demo place, to 5 decimals (about a metre). */
const at = (eastM: number, northM: number) => ({
  lat: Math.round((DEMO_PLACE.lat + northM / M_PER_DEG_LAT) * 1e5) / 1e5,
  lng:
    Math.round(
      (DEMO_PLACE.lng + eastM / (M_PER_DEG_LAT * Math.cos((DEMO_PLACE.lat * Math.PI) / 180))) * 1e5,
    ) / 1e5,
});

export interface DemoShop {
  phone: string;
  name: string;
  categories: Category[];
  lat: number;
  lng: number;
  /** The standing "ghar bhej denge" offer; absent means pickup only. */
  delivery?: { feePaise: number; minutes: number };
  /** How far it delivers in km (null: no limit). Pickup-only shops get a token 0.1. */
  deliveryMaxKm: number | null;
}

/** Five shops on 9000000102 to 106, every pair 300 m to 1.5 km apart. Names are made up. */
export const DEMO_SHOPS: DemoShop[] = [
  {
    phone: '+919000000102',
    name: 'Sharma Kirana & General Store',
    categories: ['grocery', 'general_store'],
    ...at(0, 0),
    delivery: { feePaise: 2000, minutes: 30 },
    deliveryMaxKm: 3,
  },
  {
    phone: '+919000000103',
    name: 'Shree Ganesh Masala Bhandar',
    categories: ['grocery'],
    ...at(600, 300),
    deliveryMaxKm: 0.1,
  },
  {
    phone: '+919000000104',
    name: 'Vijay Nagar Stationers',
    categories: ['stationery', 'general_store'],
    ...at(-400, 600),
    deliveryMaxKm: 0.1,
  },
  {
    phone: '+919000000105',
    name: 'Jain Electricals & Hardware',
    categories: ['electrical', 'hardware'],
    ...at(-300, -600),
    deliveryMaxKm: 0.1,
  },
  {
    phone: '+919000000106',
    name: 'Agrawal General Store',
    categories: ['general_store', 'household_kitchen', 'personal_care'],
    ...at(500, -400),
    delivery: { feePaise: 3000, minutes: 40 },
    deliveryMaxKm: 4,
  },
];

/** Demo customers 9000000202 to 206. */
export const DEMO_CUSTOMER_PHONES = ['202', '203', '204', '205', '206'].map(
  (n) => `+919000000${n}`,
);

/** Clearly not a real address: it says so, so no one mistakes it for a person's home. */
export const DEMO_ADDRESS =
  'DEMO ADDRESS: Flat 4B, Demo Apartments, Vijay Nagar, Indore (not real)';
export const DEMO_CUSTOMER_NAME = 'Demo';

/** The numbers a reset treats as demo: 9000000101 to 110 (shops) and 201 to 210 (customers). */
export const DEMO_PHONES: string[] = [
  ...Array.from({ length: 10 }, (_, i) => `+919000000${101 + i}`),
  ...Array.from({ length: 10 }, (_, i) => `+919000000${201 + i}`),
];
export const isDemoPhone = (phone: string): boolean => DEMO_PHONES.includes(phone);

/** Simulated shops for the autopilot, around the demo place (made once, then kept). */
export const DEMO_SIMULATED_SHOPS = { count: 8, radiusM: 1500, seed: 2026 } as const;

export const DEMO_STOCK_NOTE =
  'ILLUSTRATIVE: invented prices for a demo of Indore in 2026, not a price survey. ' +
  'Nobody should read them as what these shops really charge.';

export interface DemoStockRow {
  /** Index into DEMO_SHOPS. */
  shop: number;
  /** A slug of catalog.seed.json. */
  slug: string;
  pricePaise: number;
}

/** [slug, price in paise] per shop. Close to the catalog's shelf prices, a little different shop to shop. */
const BY_SHOP: [string, number][][] = [
  // 0: kirana and general store
  [
    ['wheat-flour', 26000],
    ['rice', 6200],
    ['sugar', 4900],
    ['salt', 2800],
    ['toor-dal', 17000],
    ['refined-oil', 15500],
    ['milk', 3400],
    ['bread', 4600],
    ['biscuits', 1000],
    ['cold-drink', 4000],
    ['chips', 2000],
  ],
  // 1: masala bhandar
  [
    ['turmeric-powder', 4800],
    ['red-chilli-powder', 5800],
    ['coriander-powder', 4600],
    ['cumin-seeds', 9500],
    ['garam-masala', 6500],
    ['besan', 7800],
    ['salt', 2600],
    ['toor-dal', 16500],
    ['wheat-flour', 25500],
    ['sugar', 4800],
  ],
  // 2: stationers
  [
    ['notebook', 6500],
    ['ball-pen', 1000],
    ['gel-pen', 2000],
    ['pencil', 500],
    ['ruler', 2200],
    ['geometry-box', 12500],
    ['scissors', 6500],
    ['a4-paper', 37000],
    ['cold-drink', 4200],
  ],
  // 3: electricals and hardware
  [
    ['led-bulb', 9500],
    ['tube-light', 36000],
    ['extension-board', 38000],
    ['electric-switch', 4200],
    ['battery-aa', 2200],
    ['torch', 26000],
    ['hammer', 24000],
    ['screwdriver', 13000],
  ],
  // 4: general store (household and personal care)
  [
    ['cold-drink', 4200],
    ['mineral-water', 2000],
    ['chips', 2000],
    ['water-bottle', 11000],
    ['steel-bottle', 32000],
    ['broom', 12500],
    ['soap', 3600],
    ['shampoo', 18500],
    ['toothpaste', 9500],
  ],
];

export const DEMO_STOCK: DemoStockRow[] = BY_SHOP.flatMap((rows, shop) =>
  rows.map(([slug, pricePaise]) => ({ shop, slug, pricePaise })),
);
