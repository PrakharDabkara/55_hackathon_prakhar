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
  errItemBlocked: string;
  errItemUnavailable: string;
  errNewItemLimit: (scope: string) => string;
  newItemNote: string;
  newItemTag: string;
  errandBlocked: string;
  errNotSeeker: string;
  needLocation: string;
  sortCheap: string;
  sortNear: string;
  sortLabel: string;
  statusLine: (sent: number, yes: number, no: number, pending: number) => string;
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

  // Errand screen (Day 14b)
  errandEntry: string;
  errandBack: string;
  errandTaskLabel: string;
  errandExamplesTitle: string;
  errandExamples: string[];
  errandBudgetLabel: string;
  errandMake: string;
  errandMaking: string;
  errErrandRejected: string;
  errErrandLimit: string;
  errandStates: Record<
    | 'PLANNING'
    | 'WAITING_FOR_SHOPS'
    | 'NEEDS_INPUT'
    | 'PLAN_READY'
    | 'FAILED'
    | 'EXPIRED'
    | 'CANCELLED',
    string
  >;
  errandProgressTitle: string;
  errandWaiting: string;
  errandElapsed: (mmss: string) => string;
  errandCancel: string;
  errandLateTitle: (count: number) => string;
  errandQuestionTitle: string;
  errandAnswerLabel: string;
  errandPickPlan: string;
  errandTabKam: string;
  errandTabSasta: string;
  errandRecommended: string;
  /** Why the fewest-shops plan is recommended; `extra` is null when it costs no more. */
  reasonKam: (extra: string | null, saved: number) => string;
  reasonSasta: (extra: string, saved: number) => string;
  reasonSame: string;
  errandConfirmed: string;
  errandLikely: string;
  errandNotFound: string;
  errandMatched: (said: string, got: string, confirmed: boolean) => string;
  errandTotals: string;
  errandTotal: string;
  errandSavings: string;
  errandStops: string;
  errandDistance: string;
  errandRoute: string;
  errandMapLabel: string;
  errandNew: string;
  errandFailed: string;
  errandFailedAi: string;
  errandRetry: string;
  errandExpired: string;
  errandCancelled: string;
  errandConfirmList: string;
  errandSummaryTitle: string;
  errandSummary: (found: number, total: number, shops: number, distance: string) => string;
  errandNotFoundNames: (names: string) => string;
  errandNotConfirmed: (count: number) => string;
  errandMore: string;
  errandFoundTitle: string;
  errandNothingYet: string;
  errandAskAgain: string;
  errandGone: string;

  // Exact quantity and delivery (ADR-0031)
  qtyHas: (quantity: string) => string;
  qtyShort: (quantity: string) => string;
  qtyNotEnough: string;
  qtyLast: (quantity: string) => string;
  qtyAmountLabel: string;
  errUnitNeeded: string;
  deliveryOffer: string;
  deliveryStanding: string;
  deliveryChip: (fee: string | null, free: boolean, minutes: number | null) => string;
  deliveryFeeLabel: string;
  deliveryMinutesLabel: string;
  deliverySettings: string;
  save: string;
  saved: string;
  modePickup: string;
  modeDelivery: string;
  feeLine: string;
  grandTotal: string;
  unknownPrices: (count: number) => string;
  unknownFees: (count: number) => string;
  shopOpen: string;
  shopClosed: string;
  errSetOpen: string;

  // Delivery orders (ADR-0031, PR D)
  orderFeeLine: (fee: string | null, free: boolean, minutes: number | null) => string;
  orderCod: string;
  orderSend: string;
  orderBack: string;
  orderAddressLabel: string;
  orderNameLabel: string;
  orderPinNote: string;
  orderSaved: (address: string) => string;
  orderConfirm: string;
  orderCancel: string;
  orderWaiting: string;
  orderAccepted: string;
  orderOut: string;
  orderDelivered: string;
  orderDeclined: string;
  orderExpired: string;
  orderCancelled: string;
  orderErrClosed: string;
  orderErrGeneric: string;
  orderYourAddress: (address: string) => string;
  // Notifications (ADR-0034)
  notifyOn: string;
  notifyOff: string;
  notifyIosHint: string;
  notifyBlocked: string;
  notifyFailed: string;
  // Finding an order again (ADR-0033, PR E)
  myOrdersEntry: string;
  myOrdersEmpty: string;
  myOrdersError: string;
  ordersActive: (count: number) => string;
  orderTotal: (amount: string) => string;
  orderTotalUnknown: string;
  orderDoneFull: string;
  orderSeeSource: string;
  orderNotFound: string;
  orderAddressGone: string;
  orderRemember: string;
  savedAddressTitle: string;
  savedAddressForget: string;
  recentTitle: string;
  homeBack: string;
  shopOrdersActiveTitle: string;
  shopOrdersPastTitle: string;
  shopOrderTitle: string;
  shopOrderAccept: string;
  shopOrderDecline: string;
  shopOrderOut: string;
  shopOrderDelivered: string;
  shopOrderMap: string;
  shopOrderContact: string;
  shopOrderItems: string;
  shopOrderFee: string;
  shopOrderCod: string;
  shopOrderWaiting: (minutes: number) => string;
  shopOrderDone: string;
  shopOrderDeclined: string;
  shopOrderExpired: string;
  shopOrderCancelled: string;
  shopOrderOutNow: string;
  pingGone: string;
  // Photos (optional, both sides)
  photoAdd: string;
  photoAddFor: (what: string) => string;
  photoRemove: string;
  photoPreparing: string;
  photoUploading: (percent: number) => string;
  photoPreviewAlt: string;
  photoCustomer: string;
  photoShop: string;
  photoEnlarge: (what: string) => string;
  photoClose: string;
  errPhotoTooLarge: string;
  errPhotoLimit: string;
  errPhotoBad: string;
  errPhotoNetwork: string;
  errPhotoFull: string;
  errPhoto: string;

  categories: Record<Category, string>;
  /** Each category as a tile: Devanagari with its Hinglish name under it (English: the English name). */
  categoryLabels: Record<Category, Label>;
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
  categoriesTitle: 'Aap kya bechte hain? (1 se 3 chunein)',
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
  errUnresolved: 'Ye cheez samajh nahi aayi — thoda aur batayein',
  errItemBlocked: 'Ye cheez hum dukaanon ko nahi bhej sakte',
  errItemUnavailable: 'Abhi ye cheez dukaanon ko nahi bhej sakte',
  errNewItemLimit: (scope) =>
    scope === 'errand'
      ? 'Ek kaam mein 5 se zyada nayi cheezein nahi pooch sakte'
      : 'Aaj ke liye nayi cheezon ki limit poori ho gayi, kal phir koshish karein',
  newItemNote: 'Nayi cheez: dukaanon se pooch rahe hain',
  newItemTag: 'Nayi cheez',
  errandBlocked: 'Ye cheez hum dukaanon ko nahi bhej sakte',
  errNotSeeker: 'Yeh dukaan ka number hai. Customer ke liye dusra number use karein.',
  needLocation: 'Pehle apni location chunein.',
  sortCheap: 'Sasta',
  sortNear: 'Paas',
  sortLabel: 'Kaise dikhayein',
  statusLine: (sent, yes, no, pending) =>
    `${sent} dukaanon se poocha · ${yes} ne haan kaha · ${no} ne mana kiya · ${pending} ka jawab baaki`,
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

  errandEntry: 'Poora kaam batao',
  errandBack: 'Wapas',
  errandTaskLabel: 'Kya kaam hai?',
  errandExamplesTitle: 'Jaise:',
  errandExamples: [
    'chai banane ka saaman',
    'chai: chai patti, chini, doodh',
    'school project: chart paper, fevicol, sketch pens',
    'puja ka saaman',
  ],
  errandBudgetLabel: 'Budget ₹ (zaroori nahi)',
  errandMake: 'Plan banao',
  errandMaking: 'Plan ban raha hai…',
  errErrandRejected: 'Kaam saaf nahi likha hai. Bas likhein kya kya lena hai.',
  errErrandLimit: 'Abhi bahut saare kaam ho gaye. Thodi der baad dobara try karein.',
  errandStates: {
    PLANNING: 'Soch raha hoon',
    WAITING_FOR_SHOPS: 'Dukaanon se pooch rahe hain',
    NEEDS_INPUT: 'Aapka jawab chahiye',
    PLAN_READY: 'Plan taiyaar',
    FAILED: 'Plan nahi bana',
    EXPIRED: 'Time khatam',
    CANCELLED: 'Cancel ho gaya',
  },
  errandProgressTitle: 'Ab tak kya hua',
  errandWaiting: 'Dukaanon ke jawab ka intezaar…',
  errandElapsed: (mmss) => `Samay: ${mmss}`,
  errandCancel: 'Cancel karein',
  errandLateTitle: (count) => `Baad mein aaye jawab (${count})`,
  errandQuestionTitle: 'Ek sawaal',
  errandAnswerLabel: 'Apna jawab likhein',
  errandPickPlan: 'Plan chunein',
  errandTabKam: 'Kam dukaan',
  errandTabSasta: 'Sabse sasta',
  errandRecommended: 'Recommended',
  reasonKam: (extra, saved) =>
    extra === null ? `Same daam, ${saved} dukaan kam` : `${extra} zyada, ${saved} dukaan kam`,
  reasonSasta: (extra, saved) => `Kam dukaan mein ${extra} zyada lagte, ${saved} dukaan kam`,
  reasonSame: 'Dono plan ek jaise hain',
  errandConfirmed: '✓ Confirmed',
  errandLikely: 'Likely · pichhle jawab se',
  errandNotFound: 'Nahi mila',
  errandMatched: (said, got, confirmed) =>
    confirmed
      ? `Aapne '${said}' kaha tha — dukaan ne '${got}' confirm kiya`
      : `Aapne '${said}' kaha tha — dukaan ke paas '${got}' hai`,
  errandTotals: 'Kul hisaab',
  errandTotal: 'Kul daam',
  errandSavings: 'Bachat',
  errandStops: 'Dukaanein',
  errandDistance: 'Doori',
  errandRoute: 'Raasta kholo',
  errandMapLabel: 'Raasta',
  errandNew: 'Naya kaam',
  errandFailed: 'Plan nahi ban paya.',
  errandFailedAi: 'AI abhi available nahi hai. Thodi der baad dobara try karein.',
  errandRetry: 'Dobara koshish karein',
  errandExpired: 'Time khatam ho gaya, plan nahi ban paya.',
  errandCancelled: 'Errand cancel kar diya.',
  errandConfirmList: 'Theek hai',
  errandSummaryTitle: 'Saaransh',
  errandSummary: (found, total, shops, distance) =>
    `${total} mein se ${found} ${found === 1 ? 'cheez' : 'cheezein'} mili · ${shops} ${shops === 1 ? 'dukaan' : 'dukaanein'} · ${distance}`,
  errandNotFoundNames: (names) => `Nahi mila: ${names}`,
  errandNotConfirmed: (count) =>
    `Abhi confirm nahi: ${count} ${count === 1 ? 'cheez' : 'cheezein'} (pichhle jawab se)`,
  errandMore: 'Kuch aur?',
  errandFoundTitle: 'Mil gaya',
  errandNothingYet: 'Abhi kisi dukaan ne jawab nahi diya',
  errandAskAgain: 'Dukaanon se phir poochein',
  errandGone: 'Ye kaam nahi mila.',

  qtyHas: (quantity) => `${quantity} hai`,
  qtyShort: (quantity) => `Sirf ${quantity} hai`,
  qtyNotEnough: 'Kam hai (not enough)',
  qtyLast: (quantity) => `Pichhli baar: ${quantity}`,
  qtyAmountLabel: 'Kitna hai? (maatra)',
  errUnitNeeded: 'Maatra ke saath unit chunein (kg, g, L, ml, piece ya packet).',
  deliveryOffer: 'Ghar bhej denge',
  deliveryStanding: 'Hum ghar bhejte hain',
  deliveryChip: (fee, free, minutes) =>
    ['Ghar bhej denge', free ? 'muft' : fee, minutes !== null ? `${minutes} min` : null]
      .filter(Boolean)
      .join(' · '),
  deliveryFeeLabel: 'Delivery ka daam (₹)',
  deliveryMinutesLabel: 'Kitne minute mein?',
  deliverySettings: 'Delivery ki settings',
  save: 'Save karein',
  saved: 'Save ho gaya',
  modePickup: 'Khud lene jaunga',
  modeDelivery: 'Ghar mangwao',
  feeLine: 'Delivery ka daam',
  grandTotal: 'Kul (delivery ke saath)',
  unknownPrices: (count) => `+ ${count} ${count === 1 ? 'cheez' : 'cheezein'} ka daam pata nahi`,
  unknownFees: (count) =>
    `+ ${count} ${count === 1 ? 'dukaan' : 'dukaanon'} ka delivery daam pata nahi`,
  shopOpen: 'Dukaan khuli hai',
  shopClosed: 'Dukaan aaj band hai',
  errSetOpen: 'Ye nahi ho paya. Dobara try karein.',
  orderFeeLine: (fee, free, minutes) =>
    ['Delivery', free ? 'muft' : fee, minutes !== null ? `${minutes} min` : null]
      .filter(Boolean)
      .join(' · '),
  orderCod: 'Cash on delivery: paise ghar par cash mein dena. App mein koi payment nahi.',
  orderSend: 'Order bhejo',
  orderBack: 'Rehne do',
  orderAddressLabel: 'Ghar ka pata',
  orderNameLabel: 'Aapka naam (zaroori nahi)',
  orderPinNote: 'Dukaan ko aapki location ka map pin milega, jab wo order accept kar le.',
  orderSaved: (address) => `Yaad rakha hua pata: ${address}`,
  orderConfirm: 'Pakka karo',
  orderCancel: 'Order cancel karo',
  orderWaiting: 'Dukaan ke jawab ka intezaar… (10 minute tak)',
  orderAccepted: 'Dukaan ne order le liya',
  orderOut: 'Nikal gaye — raste mein hai',
  orderDelivered: 'Pahunch gaya. Paise cash mein dein.',
  orderDeclined: 'Dukaan ne mana kiya. Aap khud jaakar le lein.',
  orderExpired: 'Dukaan ne jawab nahi diya. Aap khud jaakar le lein.',
  orderCancelled: 'Order cancel ho gaya.',
  orderErrClosed: 'Ye dukaan abhi band hai.',
  orderErrGeneric: 'Order nahi bhej paaye. Dobara try karein.',
  orderYourAddress: (address) => `Pata: ${address}`,
  notifyOn: 'Notification chalu karein',
  notifyOff: 'Notification band karein',
  notifyIosHint: "Pehle 'Add to Home Screen' karein",
  notifyBlocked: 'Notification band hain. Browser ki settings mein allow karein.',
  notifyFailed: 'Notification chalu nahi ho paaye. Dobara try karein.',
  myOrdersEntry: 'Mere orders',
  myOrdersEmpty: 'Abhi koi order nahi.',
  myOrdersError: 'Orders nahi dikh paaye. Dobara try karein.',
  ordersActive: (count) => `${count} order chal rahe hain`,
  orderTotal: (amount) => `Kul (delivery mila kar): ${amount}`,
  orderTotalUnknown: 'Daam dukaan se poochein',
  orderDoneFull: 'Pahuncha diya — order poora hua',
  orderSeeSource: 'Dukaan dekhein',
  orderNotFound: 'Ye order nahi mila.',
  orderAddressGone: 'Pata 30 din baad hata diya jaata hai.',
  orderRemember: 'Is pate ko yaad rakhein',
  savedAddressTitle: 'Yaad rakha hua pata',
  savedAddressForget: 'Pata hatayein',
  recentTitle: 'Haal ke kaam',
  homeBack: 'Wapas',
  shopOrdersActiveTitle: 'Chal rahe orders',
  shopOrdersPastTitle: 'Pichhle orders',
  shopOrderTitle: 'Ghar bhejne ka order',
  shopOrderAccept: 'Accept',
  shopOrderDecline: 'Decline',
  shopOrderOut: 'Nikal gaye',
  shopOrderDelivered: 'Pahuncha diya',
  shopOrderMap: 'Map par dekho',
  shopOrderContact: 'Sampark',
  shopOrderItems: 'Saaman',
  shopOrderFee: 'Delivery',
  shopOrderCod: 'Cash on delivery: grahak ghar par cash dega.',
  shopOrderWaiting: (minutes) => `Jawab dene ke liye ${minutes} min`,
  shopOrderDone: 'Pahuncha diya gaya',
  shopOrderDeclined: 'Aapne mana kiya',
  shopOrderExpired: 'Samay nikal gaya',
  shopOrderCancelled: 'Grahak ne order cancel kiya',
  shopOrderOutNow: 'Raste mein hai',
  pingGone: 'Grahak ko jawab mil gaya — shukriya',
  photoAdd: 'Photo jodein',
  photoAddFor: (what) => `Photo jodein: ${what}`,
  photoRemove: 'Photo hatayein',
  photoPreparing: 'Photo taiyaar ho rahi hai…',
  photoUploading: (percent) => `Upload ho raha hai ${percent}%`,
  photoPreviewAlt: 'Aapki photo',
  photoCustomer: 'Customer ki photo',
  photoShop: 'Dukaan ki photo',
  photoEnlarge: (what) => `${what}: bada karein`,
  photoClose: 'Band karein',
  errPhotoTooLarge: 'Photo bahut badi hai. Chhoti photo chunein.',
  errPhotoLimit: 'Aaj ke liye 10 photo ho chuki hain. Kal phir jodein.',
  errPhotoBad: 'Ye photo nahi chalegi. JPEG, PNG ya WebP photo chunein.',
  errPhotoNetwork: 'Internet nahi chal raha. Dobara try karein.',
  errPhotoFull: 'Abhi photo nahi le sakte. Bina photo ke aage badhein.',
  errPhoto: 'Photo upload nahi ho payi. Dobara try karein.',

  categories: {
    grocery: 'किराना',
    hardware: 'हार्डवेयर',
    electrical: 'बिजली का सामान',
    stationery: 'स्टेशनरी',
    mobile_accessories: 'मोबाइल एक्सेसरीज़',
    household_kitchen: 'घर और रसोई',
    personal_care: 'पर्सनल केयर',
    general_store: 'जनरल स्टोर',
    dairy: 'डेयरी',
    sabzi_fruit: 'सब्ज़ी और फल',
    pooja: 'पूजा का सामान',
    medical: 'मेडिकल',
    bakery_sweets: 'बेकरी और मिठाई',
  },
  categoryLabels: {
    grocery: { main: 'किराना', sub: 'Kirana' },
    hardware: { main: 'हार्डवेयर', sub: 'Hardware' },
    electrical: { main: 'बिजली का सामान', sub: 'Bijli ka saaman' },
    stationery: { main: 'स्टेशनरी', sub: 'Stationery' },
    mobile_accessories: { main: 'मोबाइल एक्सेसरीज़', sub: 'Mobile accessories' },
    household_kitchen: { main: 'घर और रसोई', sub: 'Ghar aur rasoi' },
    personal_care: { main: 'पर्सनल केयर', sub: 'Personal care' },
    general_store: { main: 'जनरल स्टोर', sub: 'General store' },
    dairy: { main: 'डेयरी', sub: 'Dairy' },
    sabzi_fruit: { main: 'सब्ज़ी और फल', sub: 'Sabzi aur phal' },
    pooja: { main: 'पूजा का सामान', sub: 'Pooja ka saaman' },
    medical: { main: 'मेडिकल', sub: 'Medical' },
    bakery_sweets: { main: 'बेकरी और मिठाई', sub: 'Bakery aur mithai' },
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
  categoriesTitle: 'What do you sell? (pick 1 to 3)',
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
  errUnresolved: "We couldn't understand that item. Please tell us a little more.",
  errItemBlocked: "We can't send this item to shops",
  errItemUnavailable: "We can't send this item to shops right now",
  errNewItemLimit: (scope) =>
    scope === 'errand'
      ? "You can't ask about more than 5 new items in one errand"
      : "You've reached today's limit of new items; try again tomorrow",
  newItemNote: 'New item: asking the shops',
  newItemTag: 'New item',
  errandBlocked: "We can't send this item to shops",
  errNotSeeker: 'This number belongs to a shop. Use another number as a customer.',
  needLocation: 'Choose your location first.',
  sortCheap: 'Cheapest',
  sortNear: 'Nearest',
  sortLabel: 'Sort by',
  statusLine: (sent, yes, no, pending) =>
    `${sent} shops asked · ${yes} said yes · ${no} said no · ${pending} yet to reply`,
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

  errandEntry: 'Describe a whole errand',
  errandBack: 'Back',
  errandTaskLabel: 'What is the errand?',
  errandExamplesTitle: 'For example:',
  errandExamples: [
    'chai banane ka saaman',
    'chai: chai patti, chini, doodh',
    'school project: chart paper, fevicol, sketch pens',
    'puja ka saaman',
  ],
  errandBudgetLabel: 'Budget ₹ (optional)',
  errandMake: 'Make a plan',
  errandMaking: 'Making the plan…',
  errErrandRejected: 'The errand is not clear. Just write what you need to buy.',
  errErrandLimit: 'Too many errands for now. Please try again in a little while.',
  errandStates: {
    PLANNING: 'Thinking',
    WAITING_FOR_SHOPS: 'Asking the shops',
    NEEDS_INPUT: 'Needs your answer',
    PLAN_READY: 'Plan ready',
    FAILED: 'No plan',
    EXPIRED: 'Time is up',
    CANCELLED: 'Cancelled',
  },
  errandProgressTitle: 'What has happened so far',
  errandWaiting: 'Waiting for the shops to answer…',
  errandElapsed: (mmss) => `Time: ${mmss}`,
  errandCancel: 'Cancel',
  errandLateTitle: (count) => `Answers that came later (${count})`,
  errandQuestionTitle: 'One question',
  errandAnswerLabel: 'Write your answer',
  errandPickPlan: 'Choose a plan',
  errandTabKam: 'Fewest shops',
  errandTabSasta: 'Cheapest',
  errandRecommended: 'Recommended',
  reasonKam: (extra, saved) =>
    `${extra === null ? 'Same price' : `${extra} more`}, ${saved} fewer ${saved === 1 ? 'shop' : 'shops'}`,
  reasonSasta: (extra, saved) =>
    `Fewest shops would cost ${extra} more, ${saved} fewer ${saved === 1 ? 'shop' : 'shops'}`,
  reasonSame: 'Both plans are alike',
  errandConfirmed: '✓ Confirmed',
  errandLikely: 'Likely · from an earlier answer',
  errandNotFound: 'Not found',
  errandMatched: (said, got, confirmed) =>
    confirmed
      ? `You said '${said}' — the shop confirmed '${got}'`
      : `You said '${said}' — the shop has '${got}'`,
  errandTotals: 'Totals',
  errandTotal: 'Total',
  errandSavings: 'You save',
  errandStops: 'Shops',
  errandDistance: 'Distance',
  errandRoute: 'Open route',
  errandMapLabel: 'Route map',
  errandNew: 'New errand',
  errandFailed: 'No plan could be made.',
  errandFailedAi: 'The AI is not available right now. Please try again in a little while.',
  errandRetry: 'Try again',
  errandExpired: 'Time ran out, so there is no plan.',
  errandCancelled: 'The errand was cancelled.',
  errandConfirmList: 'Looks right',
  errandSummaryTitle: 'Summary',
  errandSummary: (found, total, shops, distance) =>
    `${found} of ${total} items found · ${shops} ${shops === 1 ? 'shop' : 'shops'} · ${distance}`,
  errandNotFoundNames: (names) => `Not found: ${names}`,
  errandNotConfirmed: (count) =>
    `Not confirmed just now: ${count} ${count === 1 ? 'item' : 'items'} (from earlier answers)`,
  errandMore: 'Anything else?',
  errandFoundTitle: 'Found',
  errandNothingYet: 'No shop has answered yet',
  errandAskAgain: 'Ask the shops again',
  errandGone: 'That errand was not found.',

  qtyHas: (quantity) => `${quantity} available`,
  qtyShort: (quantity) => `Only ${quantity} available`,
  qtyNotEnough: 'Kam hai (not enough)',
  qtyLast: (quantity) => `Last time: ${quantity}`,
  qtyAmountLabel: 'How much is there? (amount)',
  errUnitNeeded: 'Choose a unit with the amount (kg, g, L, ml, piece or packet).',
  deliveryOffer: 'We deliver',
  deliveryStanding: 'We deliver to homes',
  deliveryChip: (fee, free, minutes) =>
    ['We deliver', free ? 'free' : fee, minutes !== null ? `${minutes} min` : null]
      .filter(Boolean)
      .join(' · '),
  deliveryFeeLabel: 'Delivery fee (₹)',
  deliveryMinutesLabel: 'In how many minutes?',
  deliverySettings: 'Delivery settings',
  save: 'Save',
  saved: 'Saved',
  modePickup: "I'll pick it up",
  modeDelivery: 'Deliver to me',
  feeLine: 'Delivery fee',
  grandTotal: 'Total with delivery',
  unknownPrices: (count) => `+ ${count} ${count === 1 ? 'item' : 'items'} with no price`,
  unknownFees: (count) => `+ ${count} ${count === 1 ? 'shop' : 'shops'} with no delivery fee told`,
  shopOpen: 'Shop is open',
  shopClosed: 'Shop is closed today',
  errSetOpen: 'That did not work. Please try again.',
  orderFeeLine: (fee, free, minutes) =>
    ['Delivery', free ? 'free' : fee, minutes !== null ? `${minutes} min` : null]
      .filter(Boolean)
      .join(' · '),
  orderCod: 'Cash on delivery: pay in cash at your door. Nothing is paid in the app.',
  orderSend: 'Send order',
  orderBack: 'Never mind',
  orderAddressLabel: 'Home address',
  orderNameLabel: 'Your name (optional)',
  orderPinNote: 'The shop gets a map pin of your location once it accepts the order.',
  orderSaved: (address) => `Remembered address: ${address}`,
  orderConfirm: 'Confirm',
  orderCancel: 'Cancel order',
  orderWaiting: 'Waiting for the shop to answer… (up to 10 minutes)',
  orderAccepted: 'The shop accepted your order',
  orderOut: 'On its way',
  orderDelivered: 'Delivered. Pay in cash.',
  orderDeclined: 'The shop said no. Please pick it up yourself.',
  orderExpired: 'The shop did not answer. Please pick it up yourself.',
  orderCancelled: 'Order cancelled.',
  orderErrClosed: 'That shop is closed right now.',
  orderErrGeneric: 'Could not send the order. Please try again.',
  orderYourAddress: (address) => `Address: ${address}`,
  notifyOn: 'Turn on notifications',
  notifyOff: 'Turn off notifications',
  notifyIosHint: "First tap 'Add to Home Screen'",
  notifyBlocked: 'Notifications are blocked. Allow them in your browser settings.',
  notifyFailed: 'Could not turn on notifications. Please try again.',
  myOrdersEntry: 'My orders',
  myOrdersEmpty: 'No orders yet.',
  myOrdersError: 'Could not load your orders. Please try again.',
  ordersActive: (count) => `${count} active ${count === 1 ? 'order' : 'orders'}`,
  orderTotal: (amount) => `Total with delivery: ${amount}`,
  orderTotalUnknown: 'Ask the shop for the price',
  orderDoneFull: 'Delivered — order complete',
  orderSeeSource: 'See the shops',
  orderNotFound: 'That order was not found.',
  orderAddressGone: 'The address is removed after 30 days.',
  orderRemember: 'Remember this address',
  savedAddressTitle: 'Remembered address',
  savedAddressForget: 'Delete address',
  recentTitle: 'Recent',
  homeBack: 'Back',
  shopOrdersActiveTitle: 'Active orders',
  shopOrdersPastTitle: 'Past orders',
  shopOrderTitle: 'Home delivery order',
  shopOrderAccept: 'Accept',
  shopOrderDecline: 'Decline',
  shopOrderOut: 'On my way',
  shopOrderDelivered: 'Delivered',
  shopOrderMap: 'See on map',
  shopOrderContact: 'Contact',
  shopOrderItems: 'Items',
  shopOrderFee: 'Delivery',
  shopOrderCod: 'Cash on delivery: the customer pays in cash at the door.',
  shopOrderWaiting: (minutes) => `${minutes} min left to answer`,
  shopOrderDone: 'Delivered',
  shopOrderDeclined: 'You declined',
  shopOrderExpired: 'Time ran out',
  shopOrderCancelled: 'The customer cancelled the order',
  shopOrderOutNow: 'On its way',
  pingGone: 'The customer already got an answer — thank you',
  photoAdd: 'Photo jodein',
  photoAddFor: (what) => `Photo jodein: ${what}`,
  photoRemove: 'Photo hatayein',
  photoPreparing: 'Preparing the photo…',
  photoUploading: (percent) => `Uploading ${percent}%`,
  photoPreviewAlt: 'Your photo',
  photoCustomer: "Customer's photo",
  photoShop: "Shop's photo",
  photoEnlarge: (what) => `${what}: enlarge`,
  photoClose: 'Close',
  errPhotoTooLarge: 'The photo is too big. Pick a smaller one.',
  errPhotoLimit: "You've added 10 photos today. Try again tomorrow.",
  errPhotoBad: "That photo won't work. Pick a JPEG, PNG or WebP photo.",
  errPhotoNetwork: 'No internet. Please try again.',
  errPhotoFull: "Photos can't be added right now. Carry on without one.",
  errPhoto: 'The photo could not be uploaded. Please try again.',

  categories: {
    grocery: 'Grocery',
    hardware: 'Hardware',
    electrical: 'Electrical',
    stationery: 'Stationery',
    mobile_accessories: 'Mobile accessories',
    household_kitchen: 'Household & kitchen',
    personal_care: 'Personal care',
    general_store: 'General store',
    dairy: 'Dairy',
    sabzi_fruit: 'Fruits & vegetables',
    pooja: 'Pooja items',
    medical: 'Medical',
    bakery_sweets: 'Bakery & sweets',
  },
  categoryLabels: {
    grocery: { main: 'Grocery' },
    hardware: { main: 'Hardware' },
    electrical: { main: 'Electrical' },
    stationery: { main: 'Stationery' },
    mobile_accessories: { main: 'Mobile accessories' },
    household_kitchen: { main: 'Household & kitchen' },
    personal_care: { main: 'Personal care' },
    general_store: { main: 'General store' },
    dairy: { main: 'Dairy' },
    sabzi_fruit: { main: 'Fruits & vegetables' },
    pooja: { main: 'Pooja items' },
    medical: { main: 'Medical' },
    bakery_sweets: { main: 'Bakery & sweets' },
  },
  bands: {
    'under 1 km': 'under 1 km',
    '1–2 km': '1–2 km',
    '2–5 km': '2–5 km',
  },
};
