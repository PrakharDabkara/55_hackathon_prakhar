import type { Category } from '@kahanmilega/shared';

/** The distance bands the API sends, as written there. */
export type Band = 'under 1 km' | '1–2 km' | '2–5 km';

/** A big line with an optional small line below it (Devanagari first, its Latin spelling under it). */
export interface Label {
  main: string;
  sub?: string;
}

export interface Strings {
  appName: string;
  /** The label of the button that switches to the other language. */
  switchLanguage: string;

  // Login
  phoneLabel: string;
  sendOtp: string;
  otpLabel: string;
  login: string;
  demoTitle: string;
  demoNote: string;
  demoFill: string;
  errBadPhone: string;
  errTooManyOtp: string;
  errBadCode: string;
  errNoDemoCode: string;
  errGeneric: string;
  errNotShop: string;
  otherNumber: string;

  // Onboarding
  shopNameLabel: string;
  categoriesTitle: string;
  useMyLocation: string;
  locationOk: string;
  locationFailed: string;
  manualTitle: string;
  latitude: string;
  longitude: string;
  startShop: string;
  errCreateShop: string;

  // Ping card
  yes: Label;
  no: Label;
  priceLabel: string;
  quantityTitle: Label;
  few: string;
  plenty: string;
  send: string;
  skip: string;
  badPrice: string;
  emptyHome: string;
  loading: string;
  errSend: string;
  errOffline: string;
  live: string;
  targetLine: (price: string) => string;
  quantityLine: (quantity: string) => string;
  customerDistance: (band: string) => string;

  // Seeker app
  queryLabel: string;
  queryHint: string;
  seenLabel: string;
  demoLocation: string;
  search: string;
  searching: string;
  errUnresolved: string;
  errNotSeeker: string;
  needLocation: string;
  sortCheap: string;
  sortNear: string;
  sortLabel: string;
  statusLine: (sent: number, yes: number, pending: number) => string;
  statusWaiting: string;
  statusFromMemory: string;
  saveBadge: (price: string) => string;
  away: (distance: string) => string;
  route: string;
  done: string;
  timeLeft: (mmss: string) => string;
  timeUp: string;
  requestClosed: string;
  noPrice: string;
  noYesYet: string;
  mapLabel: string;
  youAreHere: string;
  forShopkeepers: string;
  retry: string;

  categories: Record<Category, string>;
  bands: Record<Band, string>;
}

/** Hindi: the one-tap words are Devanagari with the Latin spelling below; running text stays Latin so no keyboard switch is needed. */
export const hi: Strings = {
  appName: 'KahanMilega',
  switchLanguage: 'English',

  phoneLabel: 'Aapka mobile number',
  sendOtp: 'OTP bhejo',
  otpLabel: '6 ank ka OTP',
  login: 'Login karein',
  demoTitle: 'Demo mode',
  demoNote: 'Koi SMS nahi jaata. OTP yahan se bharein.',
  demoFill: 'Demo OTP bharein',
  errBadPhone: 'Mobile number sahi nahi hai. 10 ank ka number likhein.',
  errTooManyOtp: 'OTP bahut baar manga gaya. Thodi der baad dobara try karein.',
  errBadCode: 'OTP galat hai ya purana ho gaya. Naya OTP mangwayein.',
  errNoDemoCode: 'Demo OTP nahi mila. Pehle OTP bhejo dabayein.',
  errGeneric: 'Kuch gadbad ho gayi. Dobara try karein.',
  errNotShop: 'Yeh number customer ka hai. Dukaan ke liye dusra number use karein.',
  otherNumber: 'Dusra number',

  shopNameLabel: 'Dukaan ka naam',
  categoriesTitle: 'Aap kya bechte hain? (1 ya 2 chunein)',
  useMyLocation: 'Meri location use karein',
  locationOk: 'Location mil gayi ✓',
  locationFailed: 'Location nahi mili. Neeche haath se likhein.',
  manualTitle: 'Haath se likhein',
  latitude: 'Latitude',
  longitude: 'Longitude',
  startShop: 'Dukaan shuru karein',
  errCreateShop: 'Dukaan nahi ban paayi. Dobara try karein.',

  yes: { main: 'हाँ है', sub: 'Haan hai' },
  no: { main: 'नहीं है', sub: 'Nahi hai' },
  priceLabel: 'Aapka daam (₹)',
  quantityTitle: { main: 'कितना है?', sub: 'Kitna hai?' },
  few: 'थोड़ा बचा है',
  plenty: 'काफ़ी है',
  send: 'Bhejo',
  skip: 'Skip',
  badPrice: 'Daam sahi nahi hai. Jaise 45 ya 45.50 likhein (paise mein 2 ank se zyada nahi).',
  emptyHome: 'Abhi koi sawaal nahi. Naye sawaal yahan apne aap aayenge.',
  loading: 'Ruko…',
  errSend: 'Jawab nahi ja paaya. Dobara try karein.',
  errOffline: 'Internet nahi mil raha. Dobara koshish ho rahi hai.',
  live: 'Live',
  targetLine: (price) => `Customer ne ${price} mein dekha hai — kya aapke paas isse kam mein hai?`,
  quantityLine: (quantity) => `Matra: ${quantity}`,
  customerDistance: (band) => `Customer ${band} door hai`,

  queryLabel: 'क्या चाहिए?',
  queryHint: 'aata, chini, bottle brush…',
  seenLabel: 'Maine ₹__ mein dekha hai (zaroori nahi)',
  demoLocation: 'Demo location (Indore)',
  search: 'Dhoondho',
  searching: 'Dhoondh rahe hain…',
  errUnresolved:
    "Samajh nahi aaya — thoda aur detail mein likhiye (jaise 'paper clip', 'nail cutter')",
  errNotSeeker: 'Yeh dukaan ka number hai. Customer ke liye dusra number use karein.',
  needLocation: 'Pehle apni location chunein.',
  sortCheap: 'Sasta',
  sortNear: 'Paas',
  sortLabel: 'Kaise dikhayein',
  statusLine: (sent, yes, pending) =>
    `${sent} dukaanon se poocha · ${yes} ne haan kaha · ${pending} ka jawab baaki`,
  statusWaiting: 'Dukaanon ko bhej rahe hain…',
  statusFromMemory: 'Pehle ke jawabon se mila',
  saveBadge: (price) => `${price} bachenge`,
  away: (distance) => `${distance} door`,
  route: 'Raasta',
  done: 'Ho gaya',
  timeLeft: (mmss) => `Bache hain ${mmss}`,
  timeUp: 'Samay poora hua',
  requestClosed: 'Band ho gaya',
  noPrice: 'Daam nahi bataya',
  noYesYet: 'Abhi kisi ne haan nahi kaha. Jawab aate hi yahan dikhenge.',
  mapLabel: 'Nakshe par dukaanein',
  youAreHere: 'Aap yahan hain',
  forShopkeepers: 'Dukaandaar hain? Yahan jaayein',
  retry: 'Dobara try karein',

  categories: {
    grocery: 'किराना',
    hardware: 'हार्डवेयर',
    electrical: 'बिजली का सामान',
    stationery: 'स्टेशनरी',
    mobile_accessories: 'मोबाइल एक्सेसरीज़',
    household_kitchen: 'घर और रसोई',
    personal_care: 'पर्सनल केयर',
    general_store: 'जनरल स्टोर',
  },
  bands: {
    'under 1 km': '1 km se kam',
    '1–2 km': '1–2 km',
    '2–5 km': '2–5 km',
  },
};

export const en: Strings = {
  appName: 'KahanMilega',
  switchLanguage: 'हिंदी',

  phoneLabel: 'Your mobile number',
  sendOtp: 'Send OTP',
  otpLabel: '6-digit OTP',
  login: 'Log in',
  demoTitle: 'Demo mode',
  demoNote: 'No SMS is sent. Fill the OTP from here.',
  demoFill: 'Fill demo OTP',
  errBadPhone: 'That mobile number is not right. Enter a 10-digit number.',
  errTooManyOtp: 'Too many OTPs were requested. Please try again in a few minutes.',
  errBadCode: 'That OTP is wrong or has expired. Ask for a new one.',
  errNoDemoCode: 'No demo OTP yet. Tap Send OTP first.',
  errGeneric: 'Something went wrong. Please try again.',
  errNotShop: 'This number belongs to a customer. Use another number for a dukaan (shop).',
  otherNumber: 'Another number',

  shopNameLabel: 'Shop name',
  categoriesTitle: 'What do you sell? (pick 1 or 2)',
  useMyLocation: 'Use my location',
  locationOk: 'Got your location ✓',
  locationFailed: 'Could not get your location. Type it below.',
  manualTitle: 'Enter it by hand',
  latitude: 'Latitude',
  longitude: 'Longitude',
  startShop: 'Start my shop',
  errCreateShop: 'Could not create your shop. Please try again.',

  yes: { main: 'Yes, I have it' },
  no: { main: 'No' },
  priceLabel: 'Your price (₹)',
  quantityTitle: { main: 'How many are left?' },
  few: 'Only a few left',
  plenty: 'Plenty',
  send: 'Send',
  skip: 'Skip',
  badPrice: 'That price is not right. Write it like 45 or 45.50 (at most 2 digits after the dot).',
  emptyHome: 'No questions right now. New ones will appear here by themselves.',
  loading: 'Please wait…',
  errSend: 'Your answer did not go through. Please try again.',
  errOffline: 'No internet. Trying again.',
  live: 'Live',
  targetLine: (price) => `A customer saw it for ${price}. Do you have it for less?`,
  quantityLine: (quantity) => `Quantity: ${quantity}`,
  customerDistance: (band) => `Customer is ${band} away`,

  queryLabel: 'क्या चाहिए?',
  queryHint: 'aata, chini, bottle brush…',
  seenLabel: 'I saw it for ₹__ (optional)',
  demoLocation: 'Demo location (Indore)',
  search: 'Search',
  searching: 'Searching…',
  errUnresolved:
    "We couldn't tell which item you mean. Add a little more detail (like 'paper clip', 'nail cutter').",
  errNotSeeker: 'This number belongs to a shop. Use another number as a customer.',
  needLocation: 'Choose your location first.',
  sortCheap: 'Cheapest',
  sortNear: 'Nearest',
  sortLabel: 'Sort by',
  statusLine: (sent, yes, pending) =>
    `${sent} shops asked · ${yes} said yes · ${pending} yet to reply`,
  statusWaiting: 'Asking the shops…',
  statusFromMemory: 'Found from earlier answers',
  saveBadge: (price) => `Save ${price}`,
  away: (distance) => `${distance} away`,
  route: 'Directions',
  done: 'Done',
  timeLeft: (mmss) => `${mmss} left`,
  timeUp: 'Time is up',
  requestClosed: 'Closed',
  noPrice: 'Price not given',
  noYesYet: 'No shop has said yes yet. Answers will appear here as they come.',
  mapLabel: 'Shops on the map',
  youAreHere: 'You are here',
  forShopkeepers: 'Own a shop? Go here',
  retry: 'Try again',

  categories: {
    grocery: 'Grocery',
    hardware: 'Hardware',
    electrical: 'Electrical',
    stationery: 'Stationery',
    mobile_accessories: 'Mobile accessories',
    household_kitchen: 'Household & kitchen',
    personal_care: 'Personal care',
    general_store: 'General store',
  },
  bands: {
    'under 1 km': 'under 1 km',
    '1–2 km': '1–2 km',
    '2–5 km': '2–5 km',
  },
};
