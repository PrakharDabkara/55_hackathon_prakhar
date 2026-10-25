/** Copy for the customer's request and replies screen, and the choose-a-shop sheet (ADR-0042). */
export interface RepliesStrings {
  repliesTitle: string;
  itemFallback: string;
  sentTo: (shops: number, km: string) => string;
  /** The parchi line when nobody was asked. */
  sentToNone: (km: string) => string;
  /** While the server has not yet chosen the shops (the parchi line and the status line). */
  askingNearby: string;
  /** Under the parchi when nobody was asked. */
  statusNoShops: string;
  /** "All shops have replied." plus how many said no. */
  allRepliedNo: (n: number) => string;
  askNow: string;
  askNowFailed: string;
  /** Small line under a chosen item: what the customer typed. */
  youTyped: (words: string) => string;
  /** Nobody was asked, and nobody remembered has it either: why, and what to do next. */
  noShopsTitle: (km: string) => string;
  noShopsHelp: string;
  noShopsWords: string;
  noShopsWider: (km: string) => string;
  noShopsWiderFailed: string;
  noShopsDemo: string;
  /** Nobody was asked because remembered shops already answer. */
  knownTitle: string;
  knownHelp: string;
  haveIt: (n: number) => string;
  stillChecking: (n: number) => string;
  allReplied: string;
  requestEnded: string;
  repliesHeading: string;
  viewLabel: string;
  viewList: string;
  viewMap: string;
  mapLabel: string;
  youAreHere: string;
  liveLabel: string;
  newItemNote: string;
  noneYetTitle: string;
  noneYetHelp: string;
  noneFoundTitle: string;
  noneFoundHelp: string;
  stopAsking: string;
  bestPrice: string;
  answeredAgo: (ago: string) => string;
  priceNotShared: string;
  notEnough: string;
  delivers: (fee: string | null, free: boolean, minutes: number | null) => string;
  pickupOnly: string;
  photo: string;
  photoAlt: string;
  photoOpen: string;
  photoClose: string;
  confirmedByCustomer: string;
  chooseShop: string;
  trackOrder: string;
  showWay: string;
  recentHeading: string;
  hadIt: (days: number, price: string | null) => string;
  loadFailedRetry: string;
  chooseTitle: string;
  sheetItem: (item: string, qty: string | null) => string;
  modeLabel: string;
  getDelivered: string;
  deliverySub: (fee: string | null, free: boolean, minutes: number | null) => string;
  pickMeUp: string;
  pickupSub: (distance: string) => string;
  deliverTo: string;
  changeAddress: string;
  savedAddressFallback: string;
  addressLabel: string;
  addressHelp: string;
  addressShort: string;
  rememberAddress: string;
  noteLabel: string;
  noteCount: (used: number, max: number) => string;
  payCash: string;
  payCashTotal: (total: string) => string;
  payCashPlusFee: (total: string) => string;
  placeOrder: string;
  placingOrder: string;
  orderErrClosed: string;
  orderErrGeneric: string;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export const repliesEn: RepliesStrings = {
  repliesTitle: 'Your request',
  itemFallback: 'Your item',
  sentTo: (shops, km) => `Sent to ${shops} ${plural(shops, 'shop', 'shops')} · ${km} km`,
  sentToNone: (km) => `No shops asked · ${km} km`,
  askingNearby: 'Asking shops nearby…',
  statusNoShops: 'No shops were asked.',
  allRepliedNo: (n) => `All shops have replied. ${n} said they don't have it.`,
  askNow: 'Ask shops now',
  askNowFailed: "Couldn't ask the shops. Check your connection and try again.",
  youTyped: (words) => `you typed: ${words}`,
  noShopsTitle: (km) => `No open shops within ${km} km sell this kind of item yet`,
  noShopsHelp: 'Try different words, or look in a wider area.',
  noShopsWords: 'Try different words',
  noShopsWider: (km) => `Search ${km} km`,
  noShopsWiderFailed: "Couldn't search again. Check your connection and try again.",
  noShopsDemo: 'Use the demo area (Indore)',
  knownTitle: 'Nobody was asked this time',
  knownHelp:
    'We already knew these shops had it recently, so no one was pinged. They are listed below.',
  haveIt: (n) => `${n} have it`,
  stillChecking: (n) => (n === 1 ? '1 shop is still checking.' : `${n} shops are still checking.`),
  allReplied: 'All shops have replied.',
  requestEnded: 'This request has ended.',
  repliesHeading: 'Replies',
  viewLabel: 'Show replies as',
  viewList: 'List',
  viewMap: 'Map',
  mapLabel: 'Shops on the map',
  youAreHere: 'You are here',
  liveLabel: 'Live',
  newItemNote: 'New item. No shop has confirmed it yet.',
  noneYetTitle: 'No replies yet',
  noneYetHelp: 'Replies appear here as shops answer. You can leave this page open.',
  noneFoundTitle: 'No shop has it right now',
  noneFoundHelp: 'Try again later, or search for something close.',
  stopAsking: 'Stop asking',
  bestPrice: 'Best price nearby',
  answeredAgo: (ago) => `answered ${ago}`,
  priceNotShared: 'Price not shared',
  notEnough: 'Not enough',
  delivers: (fee, free, minutes) => {
    const base = free ? 'Delivers · free' : fee ? `Delivers · ${fee}` : 'Delivers · fee on request';
    return minutes !== null ? `${base} · ${minutes} min` : base;
  },
  pickupOnly: 'Pick up only',
  photo: 'Photo',
  photoAlt: "Shop's photo of the item",
  photoOpen: 'View photo',
  photoClose: 'Close photo',
  confirmedByCustomer: 'Confirmed by a customer',
  chooseShop: 'Choose this shop',
  trackOrder: 'Track order',
  showWay: 'Show the way',
  recentHeading: 'Had it recently, not asked this time',
  hadIt: (days, price) => {
    const when = days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
    return price ? `Had it ${when} at ${price}` : `Had it ${when}`;
  },
  loadFailedRetry: 'Try again',
  chooseTitle: 'Choose this shop',
  sheetItem: (item, qty) => (qty ? `${item} · ${qty}` : item),
  modeLabel: 'How do you want it?',
  getDelivered: 'Get it delivered',
  deliverySub: (fee, free, minutes) => {
    const cost = free ? 'Free delivery' : fee ? `${fee} delivery` : 'Delivery fee on request';
    return `${cost}${minutes !== null ? ` · about ${minutes} min` : ''} · pay cash`;
  },
  pickMeUp: "I'll pick it up",
  pickupSub: (distance) => `${distance} · we'll show the way`,
  deliverTo: 'Deliver to',
  changeAddress: 'Change',
  savedAddressFallback: 'The address you chose when you searched',
  addressLabel: 'Delivery address',
  addressHelp: 'House or flat number, street, landmark.',
  addressShort: 'Add your full address.',
  rememberAddress: 'Remember this address',
  noteLabel: 'Note for the shop',
  noteCount: (used, max) => `${used}/${max}`,
  payCash: 'Pay cash on delivery',
  payCashTotal: (total) => `Pay cash on delivery · ${total}`,
  payCashPlusFee: (total) => `Pay cash on delivery · ${total} + delivery fee`,
  placeOrder: 'Place order',
  placingOrder: 'Placing order',
  orderErrClosed: 'This shop is closed right now. Choose pick up or another shop.',
  orderErrGeneric: "Couldn't place the order. Try again.",
};

export const repliesHi: RepliesStrings = {
  repliesTitle: 'Aapki request',
  itemFallback: 'Aapki cheez',
  sentTo: (shops, km) => `${shops} dukaanon ko bheja · ${km} km`,
  sentToNone: (km) => `Kisi dukaan se nahi poocha · ${km} km`,
  askingNearby: 'Paas ki dukaanon se pooch rahe hain…',
  statusNoShops: 'Kisi dukaan se nahi poocha gaya.',
  allRepliedNo: (n) => `Sab dukaanon ne jawab de diya. ${n} ne kaha nahi hai.`,
  askNow: 'Abhi dukaanon se poochein',
  askNowFailed: 'Dukaanon se pooch nahi paye. Internet check karke dobara try karein.',
  youTyped: (words) => `aapne likha: ${words}`,
  noShopsTitle: (km) => `${km} km ke andar abhi koi khuli dukaan ye cheez nahi bechti`,
  noShopsHelp: 'Doosre shabd try karein, ya bada ilaaka dekhein.',
  noShopsWords: 'Doosre shabd try karein',
  noShopsWider: (km) => `${km} km mein dhundhein`,
  noShopsWiderFailed: 'Dobara nahi dhundh paye. Internet check karke dobara try karein.',
  noShopsDemo: 'Demo ilaaka (Indore) istemal karein',
  knownTitle: 'Is baar kisi se poocha nahi',
  knownHelp:
    'Hum pehle se jaante the ki in dukaanon ke paas thi, isliye poocha nahi. Neeche dekhein.',
  haveIt: (n) => `${n} ke paas hai`,
  stillChecking: (n) => `${n} dukaan abhi dekh rahi ${n === 1 ? 'hai' : 'hain'}.`,
  allReplied: 'Sab dukaanon ne jawab de diya.',
  requestEnded: 'Ye request khatam ho gayi.',
  repliesHeading: 'Jawab',
  viewLabel: 'Jawab dekhein',
  viewList: 'List',
  viewMap: 'Naksha',
  mapLabel: 'Nakshe par dukaanein',
  youAreHere: 'Aap yahan hain',
  liveLabel: 'Live',
  newItemNote: 'Nayi cheez. Abhi kisi dukaan ne confirm nahi kiya.',
  noneYetTitle: 'Abhi koi jawab nahi',
  noneYetHelp: 'Dukaan jawab dengi to yahan dikhega. Ye page khula rakhein.',
  noneFoundTitle: 'Abhi kisi ke paas nahi hai',
  noneFoundHelp: 'Baad mein phir try karein, ya milti-julti cheez dhundhein.',
  stopAsking: 'Poochna band karein',
  bestPrice: 'Aas-paas sabse sasta',
  answeredAgo: (ago) => `jawab diya ${ago}`,
  priceNotShared: 'Daam nahi bataya',
  notEnough: 'Kam hai',
  delivers: (fee, free, minutes) => {
    const base = free
      ? 'Ghar bhejenge · muft'
      : fee
        ? `Ghar bhejenge · ${fee}`
        : 'Ghar bhejenge · fees puchhein';
    return minutes !== null ? `${base} · ${minutes} min` : base;
  },
  pickupOnly: 'Sirf pick-up',
  photo: 'Photo',
  photoAlt: 'Dukaan ki photo',
  photoOpen: 'Photo dekhein',
  photoClose: 'Photo band karein',
  confirmedByCustomer: 'Grahak ne confirm kiya',
  chooseShop: 'Ye dukaan chunein',
  trackOrder: 'Order dekhein',
  showWay: 'Raasta dikhayein',
  recentHeading: 'Pehle thi, is baar poocha nahi',
  hadIt: (days, price) => {
    const when = days <= 0 ? 'aaj' : days === 1 ? 'kal' : `${days} din pehle`;
    return price ? `${when} thi, ${price} mein` : `${when} thi`;
  },
  loadFailedRetry: 'Phir se try karein',
  chooseTitle: 'Ye dukaan chunein',
  sheetItem: (item, qty) => (qty ? `${item} · ${qty}` : item),
  modeLabel: 'Kaise chahiye?',
  getDelivered: 'Ghar mangwayein',
  deliverySub: (fee, free, minutes) => {
    const cost = free ? 'Delivery muft' : fee ? `${fee} delivery` : 'Delivery fees puchhein';
    return `${cost}${minutes !== null ? ` · lagbhag ${minutes} min` : ''} · cash dein`;
  },
  pickMeUp: 'Main khud le lunga',
  pickupSub: (distance) => `${distance} · raasta dikhayenge`,
  deliverTo: 'Yahan bhejein',
  changeAddress: 'Badlein',
  savedAddressFallback: 'Jo pata search mein chuna tha',
  addressLabel: 'Ghar ka pata',
  addressHelp: 'Ghar ya flat number, gali, landmark.',
  addressShort: 'Poora pata likhein.',
  rememberAddress: 'Is pate ko yaad rakhein',
  noteLabel: 'Dukaan ke liye note',
  noteCount: (used, max) => `${used}/${max}`,
  payCash: 'Delivery par cash dein',
  payCashTotal: (total) => `Delivery par cash dein · ${total}`,
  payCashPlusFee: (total) => `Delivery par cash dein · ${total} + delivery fees`,
  placeOrder: 'Order bhejein',
  placingOrder: 'Order bhej rahe hain',
  orderErrClosed: 'Ye dukaan abhi band hai. Pick-up chunein ya doosri dukaan.',
  orderErrGeneric: 'Order nahi bhej paaye. Dobara try karein.',
};
