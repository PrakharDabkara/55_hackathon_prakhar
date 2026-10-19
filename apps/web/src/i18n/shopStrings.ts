/** The shop app's copy (ADR-0041). en is the default: plain, short, a verb on every button. */
export interface ShopStrings {
  // Shared
  menu: string;
  close: string;
  retry: string;
  loadFailed: string;
  offline: string;
  sendFailed: string;
  priceInvalid: string;
  save: string;
  saved: string;
  optional: string;
  loading: string;
  // Header and sidebar
  open: string;
  closed: string;
  toastOpen: string;
  toastClosed: string;
  openFailed: string;
  mainMenu: string;
  navRequests: string;
  navOrders: string;
  navInsights: string;
  navDelivery: string;
  navNotifications: string;
  navSettings: string;
  activeCount: (n: number) => string;
  openNow: string;
  closedNow: string;
  logout: string;
  poweredBy: string;
  // Login
  forShops: string;
  mobileNumber: string;
  codeHelper: string;
  sendCode: string;
  codeLabel: string;
  codeSentTo: (phone: string) => string;
  verify: string;
  resend: string;
  demoTitle: string;
  demoFill: string;
  errBadPhone: string;
  errTooMany: string;
  errBadCode: string;
  errGeneric: string;
  errNoDemo: string;
  errNotShop: string;
  otherNumber: string;
  // Set up shop
  setupTitle: string;
  setupHelper: string;
  logoCaption: string;
  shopName: string;
  sellTitle: string;
  sellLimit: string;
  locationTitle: string;
  useLocation: string;
  pinHelper: string;
  pinHelperDenied: string;
  mapLabel: string;
  needName: string;
  needCategory: string;
  needLocation: string;
  startReceiving: string;
  createFailed: string;
  // Home
  todaysRequests: string;
  position: (n: number, total: number) => string;
  previous: string;
  next: string;
  deckLabel: string;
  dotsMore: (n: number) => string;
  activeOrders: string;
  todayLink: string;
  answeredOf: (answered: number, received: number) => string;
  orderBanner: (item: string) => string;
  viewOrder: string;
  emptyTitle: string;
  emptyBody: string;
  notificationsOn: string;
  turnOnNotifications: string;
  closedTitle: string;
  openShop: string;
  // Parchi
  replyIn: string;
  minutesShort: (n: number) => string;
  wantsDeliveryLine: string;
  deliveryStamp: string;
  cashOnDelivery: string;
  answer: string;
  decline: string;
  accept: string;
  total: string;
  deliveryLine: string;
  orderRequest: string;
  customerPhoto: string;
  priceNotSet: string;
  customerNote: (note: string) => string;
  stampAnswered: string;
  stampNotAvailable: string;
  // Answer sheets
  sheetTitle: (item: string, quantity: string | null) => string;
  inStock: string;
  notAvailable: string;
  priceLabel: string;
  price: string;
  lastTime: (price: string) => string;
  quantityLabel: (asked: string | null) => string;
  addPhoto: string;
  removePhoto: string;
  offerDelivery: (fee: string | null) => string;
  send: string;
  wantsDeliveryCaption: (band: string) => string;
  willDeliver: string;
  haveCantDeliver: string;
  cantDeliverFar: string;
  deliveryFeeLabel: string;
  fromDeliverySettings: string;
  canReachIn: string;
  min15: string;
  min30: string;
  hour1: string;
  customerPaysCash: (total: string) => string;
  committed: string;
  enterPrice: string;
  pricePlaceholder: string;
  confirm: string;
  answerChoices: string;
  pingGone: string;
  orderAccepted: string;
  orderDeclined: string;
  quantityInvalid: string;
  photoPreparing: string;
  photoUploading: (percent: number) => string;
  photoPreview: string;
  photoFailed: string;
  // Orders
  ordersTitle: string;
  tabActive: (n: number) => string;
  tabDone: (n: number) => string;
  deliveryChip: string;
  chosenAt: (time: string) => string;
  requestedAt: (time: string) => string;
  inclFee: (total: string, fee: string) => string;
  collectCash: (total: string) => string;
  openMap: string;
  forName: (name: string) => string;
  outForDelivery: string;
  cancelOrder: string;
  waitingConfirm: string;
  delivered: string;
  notConfirmed: string;
  cancelled: string;
  cancelledWhy: (reason: string) => string;
  declined: string;
  expired: string;
  noActiveOrders: string;
  noDoneOrders: string;
  cancelTitle: string;
  reasonOutOfStock: string;
  reasonCannotDeliver: string;
  reasonOther: string;
  reasonText: string;
  cancelConfirm: string;
  keepOrder: string;
  // Insights
  insightsTitle: string;
  rangeToday: string;
  range7: string;
  tileRequests: string;
  tileAnswered: string;
  tileInStock: string;
  tileReply: string;
  mostAsked: string;
  noNearby: string;
  saidNoTo: string;
  noItems: string;
  // Delivery
  deliveryTitle: string;
  iDeliver: string;
  defaultFee: string;
  usualTime: string;
  upToKm: string;
  noLimit: string;
  errFee: string;
  errKm: string;
  // Settings and notifications
  settingsTitle: string;
  logoTitle: string;
  changeLogo: string;
  removeLogo: string;
  logoFailed: string;
  logoRemoved: string;
  categoriesTitle: string;
  notificationsTitle: string;
  notificationsBody: string;
  turnOff: string;
  notificationsBlocked: string;
  notificationsIos: string;
  notificationsFailed: string;
  notificationsUnavailable: string;
}

export const shopEn: ShopStrings = {
  menu: 'Menu',
  close: 'Close',
  retry: 'Try again',
  loadFailed: "Couldn't load. Check your connection and try again.",
  offline: "You're offline. Reconnect to answer.",
  sendFailed: "Couldn't send. Check your connection and try again.",
  priceInvalid: 'Price must be a number, like 45.',
  save: 'Save',
  saved: 'Saved.',
  optional: 'optional',
  loading: 'Loading',

  open: 'Open',
  closed: 'Closed',
  toastOpen: "You're open.",
  toastClosed: "You're closed. You won't get new requests.",
  openFailed: "Couldn't change. Check your connection and try again.",
  mainMenu: 'Main menu',
  navRequests: 'Requests',
  navOrders: 'Orders',
  navInsights: 'Insights',
  navDelivery: 'Delivery',
  navNotifications: 'Notifications',
  navSettings: 'Shop settings',
  activeCount: (n) => `${n} active`,
  openNow: 'Open now',
  closedNow: 'Closed',
  logout: 'Log out',
  poweredBy: 'Powered by',

  forShops: 'For shops',
  mobileNumber: 'Mobile number',
  codeHelper: "We'll send a 6-digit code by SMS.",
  sendCode: 'Send code',
  codeLabel: '6-digit code',
  codeSentTo: (phone) => `Code sent to +91 ${phone}`,
  verify: 'Log in',
  resend: 'Send code again',
  demoTitle: 'Demo mode',
  demoFill: 'Fill the code',
  errBadPhone: 'Enter a 10-digit mobile number.',
  errTooMany: 'Too many tries. Wait a few minutes and try again.',
  errBadCode: 'That code is wrong. Check it and try again.',
  errGeneric: 'Something went wrong. Check your connection and try again.',
  errNoDemo: 'No demo code here. Use the code from the SMS.',
  errNotShop: 'This number belongs to a customer account. Log in with a shop number.',
  otherNumber: 'Use another number',

  setupTitle: 'Set up your shop',
  setupHelper: 'Customers near you will see this name.',
  logoCaption: 'Upload logo · optional',
  shopName: 'Shop name',
  sellTitle: 'What do you sell? Pick up to 3.',
  sellLimit: 'You can pick up to 3. Remove one to pick another.',
  locationTitle: 'Shop location',
  useLocation: 'Use my current location',
  pinHelper: 'Stand inside your shop, or drag the pin to it.',
  pinHelperDenied: 'Drag the pin to your shop.',
  mapLabel: 'Shop location map. Press the arrow keys to move the pin.',
  needName: 'Add your shop name to continue.',
  needCategory: 'Pick what you sell to continue.',
  needLocation: 'Set your shop location to continue.',
  startReceiving: 'Start getting requests',
  createFailed: "Couldn't create your shop. Check your connection and try again.",

  todaysRequests: "Today's requests",
  position: (n, total) => `${n} of ${total}`,
  previous: 'Previous request',
  next: 'Next request',
  deckLabel: 'Requests',
  dotsMore: (n) => `+${n}`,
  activeOrders: 'Active orders',
  todayLink: 'Today',
  answeredOf: (answered, received) => `${answered} / ${received} answered`,
  orderBanner: (item) => `Customer chose you · ${item}`,
  viewOrder: 'View order',
  emptyTitle: 'No requests right now',
  emptyBody: "We'll notify you when someone nearby asks for something you sell.",
  notificationsOn: 'Notifications are on',
  turnOnNotifications: 'Turn on notifications',
  closedTitle: "You're closed",
  openShop: 'Open shop',

  replyIn: 'Reply in',
  minutesShort: (n) => `${n}m`,
  wantsDeliveryLine: 'The customer wants this delivered',
  deliveryStamp: 'Delivery',
  cashOnDelivery: 'Cash on delivery',
  answer: 'Answer',
  decline: 'Decline',
  accept: 'Accept',
  total: 'Total',
  deliveryLine: 'Delivery',
  orderRequest: 'Order request',
  customerPhoto: 'Photo of what the customer wants',
  priceNotSet: 'Price not set',
  customerNote: (note) => `“${note}”`,
  stampAnswered: 'Answered',
  stampNotAvailable: 'Not available',

  sheetTitle: (item, quantity) => (quantity ? `${item} · ${quantity}` : item),
  inStock: 'In stock',
  notAvailable: 'Not available',
  priceLabel: 'Price · optional',
  price: 'Price',
  lastTime: (price) => `Last time you said ${price}`,
  quantityLabel: (asked) =>
    asked ? `Quantity you can give · customer asked for ${asked}` : 'Quantity you can give',
  addPhoto: 'Add a photo',
  removePhoto: 'Remove photo',
  offerDelivery: (fee) => (fee ? `Offer delivery · ${fee} fee` : 'Offer delivery'),
  send: 'Send',
  wantsDeliveryCaption: (band) => `Wants delivery · ${band}`,
  willDeliver: 'Have it, will deliver',
  haveCantDeliver: "Have it, can't deliver",
  cantDeliverFar: "You don't deliver this far",
  deliveryFeeLabel: 'Delivery fee',
  fromDeliverySettings: 'From your delivery settings',
  canReachIn: 'Can reach in',
  min15: '15 min',
  min30: '30 min',
  hour1: '1 hour',
  customerPaysCash: (total) => `Customer pays cash · ${total}`,
  committed: "If the customer picks you, you're committed to deliver.",
  enterPrice: 'Enter your price to confirm',
  pricePlaceholder: 'e.g. 45',
  confirm: 'Confirm',
  answerChoices: 'Your answer',
  pingGone: 'The customer already has an answer. Thanks for being quick.',
  orderAccepted: 'Order accepted. Open Orders to send it out.',
  orderDeclined: 'Order declined.',
  quantityInvalid: 'Quantity must be a number, like 2.',
  photoPreparing: 'Preparing photo',
  photoUploading: (percent) => `Uploading photo · ${percent}%`,
  photoPreview: 'Your photo',
  photoFailed: "Couldn't upload the photo. Try a smaller picture.",

  ordersTitle: 'Orders',
  tabActive: (n) => `Active · ${n}`,
  tabDone: (n) => `Done today · ${n}`,
  deliveryChip: 'Delivery',
  chosenAt: (time) => `Customer chose you · ${time}`,
  requestedAt: (time) => `Order request · ${time}`,
  inclFee: (total, fee) => `${total} incl. ${fee} delivery · collect cash`,
  collectCash: (total) => `${total} · collect cash`,
  openMap: 'Open map',
  forName: (name) => `For: ${name}`,
  outForDelivery: 'Out for delivery',
  cancelOrder: 'Cancel order',
  waitingConfirm: 'Waiting for the customer to confirm',
  delivered: 'Delivered',
  notConfirmed: 'Not confirmed by customer',
  cancelled: 'Cancelled',
  cancelledWhy: (reason) => `Cancelled · ${reason}`,
  declined: 'Declined',
  expired: 'Expired',
  noActiveOrders: 'No active orders',
  noDoneOrders: 'Nothing finished today yet.',
  cancelTitle: 'Cancel this order',
  reasonOutOfStock: 'Out of stock',
  reasonCannotDeliver: "Can't deliver now",
  reasonOther: 'Other',
  reasonText: 'Add a note · optional',
  cancelConfirm: 'Cancel order',
  keepOrder: 'Keep order',

  insightsTitle: 'Insights',
  rangeToday: 'Today',
  range7: '7 days',
  tileRequests: 'Requests',
  tileAnswered: 'You answered',
  tileInStock: 'Said "in stock"',
  tileReply: 'Average reply time',
  mostAsked: 'Most asked near you',
  noNearby: 'Not enough nearby requests yet.',
  saidNoTo: 'You said no to',
  noItems: 'Nothing here yet.',

  deliveryTitle: 'Delivery',
  iDeliver: 'I deliver',
  defaultFee: 'Default fee ₹',
  usualTime: 'Usual time',
  upToKm: 'Deliver up to (km)',
  noLimit: 'Leave empty for no limit.',
  errFee: 'Fee must be a number, like 20.',
  errKm: 'Distance must be between 0.1 and 100 km.',

  settingsTitle: 'Shop settings',
  logoTitle: 'Logo',
  changeLogo: 'Change logo',
  removeLogo: 'Remove logo',
  logoFailed: "Couldn't upload the logo. Try a smaller picture.",
  logoRemoved: 'Logo removed.',
  categoriesTitle: 'What you sell · up to 3',
  notificationsTitle: 'Notifications',
  notificationsBody: 'Get a buzz when someone nearby asks for something you sell.',
  turnOff: 'Turn off',
  notificationsBlocked: 'Notifications are blocked. Allow them in your browser settings.',
  notificationsIos: 'On iPhone, add this app to your Home Screen first.',
  notificationsFailed: "Couldn't turn on notifications. Try again.",
  notificationsUnavailable:
    "This browser can't show notifications. Keep this page open to see new requests.",
};

export const shopHi: ShopStrings = {
  menu: 'Menu',
  close: 'Band karein',
  retry: 'Dobara koshish karein',
  loadFailed: 'Load nahi hua. Internet check karke dobara koshish karein.',
  offline: 'Internet nahi hai. Jawab dene ke liye internet chalu karein.',
  sendFailed: 'Bhej nahi paaye. Internet check karke dobara koshish karein.',
  priceInvalid: 'Daam ek number hona chahiye, jaise 45.',
  save: 'Save karein',
  saved: 'Save ho gaya.',
  optional: 'zaroori nahi',
  loading: 'Load ho raha hai',

  open: 'Khuli',
  closed: 'Band',
  toastOpen: 'Dukaan khuli hai.',
  toastClosed: 'Dukaan band hai. Naye sawaal nahi aayenge.',
  openFailed: 'Badal nahi paaye. Internet check karke dobara koshish karein.',
  mainMenu: 'Main menu',
  navRequests: 'Sawaal',
  navOrders: 'Orders',
  navInsights: 'Aaj ki maang',
  navDelivery: 'Delivery',
  navNotifications: 'Notification',
  navSettings: 'Dukaan settings',
  activeCount: (n) => `${n} chalu`,
  openNow: 'Abhi khuli hai',
  closedNow: 'Band',
  logout: 'Log out',
  poweredBy: 'Powered by',

  forShops: 'Dukaandaar ke liye',
  mobileNumber: 'Mobile number',
  codeHelper: 'Hum SMS se 6 ank ka code bhejenge.',
  sendCode: 'Code bhejo',
  codeLabel: '6 ank ka code',
  codeSentTo: (phone) => `Code +91 ${phone} par bheja`,
  verify: 'Login karein',
  resend: 'Code dobara bhejo',
  demoTitle: 'Demo mode',
  demoFill: 'Code bharein',
  errBadPhone: '10 ank ka mobile number daalein.',
  errTooMany: 'Bahut koshish ho gayi. Kuch minute rukkar dobara karein.',
  errBadCode: 'Code galat hai. Check karke dobara daalein.',
  errGeneric: 'Kuch gadbad ho gayi. Internet check karke dobara koshish karein.',
  errNoDemo: 'Yahan demo code nahi hai. SMS wala code daalein.',
  errNotShop: 'Ye number grahak ka hai. Dukaan ke number se login karein.',
  otherNumber: 'Doosra number',

  setupTitle: 'Apni dukaan set up karein',
  setupHelper: 'Aas-paas ke grahak ye naam dekhenge.',
  logoCaption: 'Logo daalein · zaroori nahi',
  shopName: 'Dukaan ka naam',
  sellTitle: 'Aap kya bechte hain? 3 tak chunein.',
  sellLimit: '3 tak chun sakte hain. Doosra chunne ke liye ek hatayein.',
  locationTitle: 'Dukaan ki location',
  useLocation: 'Meri abhi ki location use karein',
  pinHelper: 'Dukaan ke andar khade hon, ya pin ko dukaan par khinchein.',
  pinHelperDenied: 'Pin ko apni dukaan par khinchein.',
  mapLabel: 'Dukaan ki location ka map. Pin hilane ke liye arrow keys dabayein.',
  needName: 'Aage badhne ke liye dukaan ka naam likhein.',
  needCategory: 'Aage badhne ke liye kuch chunein.',
  needLocation: 'Aage badhne ke liye dukaan ki location set karein.',
  startReceiving: 'Sawaal lena shuru karein',
  createFailed: 'Dukaan nahi bani. Internet check karke dobara koshish karein.',

  todaysRequests: 'Aaj ke sawaal',
  position: (n, total) => `${n} / ${total}`,
  previous: 'Pichhla sawaal',
  next: 'Agla sawaal',
  deckLabel: 'Sawaal',
  dotsMore: (n) => `+${n}`,
  activeOrders: 'Chalu orders',
  todayLink: 'Aaj',
  answeredOf: (answered, received) => `${answered} / ${received} jawab diye`,
  orderBanner: (item) => `Grahak ne aapko chuna · ${item}`,
  viewOrder: 'Order dekhein',
  emptyTitle: 'Abhi koi sawaal nahi',
  emptyBody: 'Jab aas-paas koi aapki cheez maangega, hum bata denge.',
  notificationsOn: 'Notification chalu hain',
  turnOnNotifications: 'Notification chalu karein',
  closedTitle: 'Dukaan band hai',
  openShop: 'Dukaan kholein',

  replyIn: 'Jawab dein',
  minutesShort: (n) => `${n} min`,
  wantsDeliveryLine: 'Grahak ye ghar mangwana chahta hai',
  deliveryStamp: 'Delivery',
  cashOnDelivery: 'Cash on delivery',
  answer: 'Jawab dein',
  decline: 'Mana karein',
  accept: 'Le lein',
  total: 'Kul',
  deliveryLine: 'Delivery',
  orderRequest: 'Order ki maang',
  customerPhoto: 'Grahak ki maangi cheez ki photo',
  priceNotSet: 'Daam nahi daala',
  customerNote: (note) => `“${note}”`,
  stampAnswered: 'Jawab diya',
  stampNotAvailable: 'Nahi hai',

  sheetTitle: (item, quantity) => (quantity ? `${item} · ${quantity}` : item),
  inStock: 'Hai',
  notAvailable: 'Nahi hai',
  priceLabel: 'Daam · zaroori nahi',
  price: 'Daam',
  lastTime: (price) => `Pichhli baar aapne ${price} kaha tha`,
  quantityLabel: (asked) =>
    asked ? `Kitna de sakte hain · grahak ne ${asked} maanga` : 'Kitna de sakte hain',
  addPhoto: 'Photo jodein',
  removePhoto: 'Photo hatayein',
  offerDelivery: (fee) => (fee ? `Ghar bhejein · ${fee} delivery` : 'Ghar bhejein'),
  send: 'Bhejo',
  wantsDeliveryCaption: (band) => `Ghar mangwana hai · ${band}`,
  willDeliver: 'Hai, ghar bhej dunga',
  haveCantDeliver: 'Hai, ghar nahi bhej sakta',
  cantDeliverFar: 'Aap itni door delivery nahi karte',
  deliveryFeeLabel: 'Delivery ka daam',
  fromDeliverySettings: 'Aapki delivery settings se',
  canReachIn: 'Kitne mein pahunchega',
  min15: '15 min',
  min30: '30 min',
  hour1: '1 ghanta',
  customerPaysCash: (total) => `Grahak cash dega · ${total}`,
  committed: 'Agar grahak aapko chune, to delivery karni hogi.',
  enterPrice: 'Pakka karne ke liye apna daam daalein',
  pricePlaceholder: 'jaise 45',
  confirm: 'Pakka karein',
  answerChoices: 'Aapka jawab',
  pingGone: 'Grahak ko jawab mil chuka hai. Jaldi karne ke liye shukriya.',
  orderAccepted: 'Order le liya. Bhejne ke liye Orders kholein.',
  orderDeclined: 'Order mana kiya.',
  quantityInvalid: 'Matra ek number honi chahiye, jaise 2.',
  photoPreparing: 'Photo taiyaar ho rahi hai',
  photoUploading: (percent) => `Photo upload ho rahi hai · ${percent}%`,
  photoPreview: 'Aapki photo',
  photoFailed: 'Photo upload nahi hui. Chhoti photo try karein.',

  ordersTitle: 'Orders',
  tabActive: (n) => `Chalu · ${n}`,
  tabDone: (n) => `Aaj poore hue · ${n}`,
  deliveryChip: 'Delivery',
  chosenAt: (time) => `Grahak ne aapko chuna · ${time}`,
  requestedAt: (time) => `Order ki maang · ${time}`,
  inclFee: (total, fee) => `${total} (${fee} delivery milakar) · cash lein`,
  collectCash: (total) => `${total} · cash lein`,
  openMap: 'Map kholein',
  forName: (name) => `Kiske liye: ${name}`,
  outForDelivery: 'Nikal gaye',
  cancelOrder: 'Order cancel karein',
  waitingConfirm: 'Grahak ke confirm karne ka intezaar',
  delivered: 'Pahunch gaya',
  notConfirmed: 'Grahak ne confirm nahi kiya',
  cancelled: 'Cancel hua',
  cancelledWhy: (reason) => `Cancel hua · ${reason}`,
  declined: 'Mana kiya',
  expired: 'Samay khatam',
  noActiveOrders: 'Koi chalu order nahi',
  noDoneOrders: 'Aaj abhi koi order poora nahi hua.',
  cancelTitle: 'Ye order cancel karein',
  reasonOutOfStock: 'Maal khatam',
  reasonCannotDeliver: 'Abhi delivery nahi ho sakti',
  reasonOther: 'Kuch aur',
  reasonText: 'Note likhein · zaroori nahi',
  cancelConfirm: 'Order cancel karein',
  keepOrder: 'Order rakhein',

  insightsTitle: 'Aaj ki maang',
  rangeToday: 'Aaj',
  range7: '7 din',
  tileRequests: 'Sawaal aaye',
  tileAnswered: 'Aapne jawab diye',
  tileInStock: '"Hai" kaha',
  tileReply: 'Jawab dene ka ausat samay',
  mostAsked: 'Aas-paas sabse zyada maanga gaya',
  noNearby: 'Aas-paas ke sawaal abhi kam hain.',
  saidNoTo: 'In par aapne nahi kaha',
  noItems: 'Abhi kuch nahi.',

  deliveryTitle: 'Delivery',
  iDeliver: 'Main delivery karta hoon',
  defaultFee: 'Delivery ka daam ₹',
  usualTime: 'Aam taur par samay',
  upToKm: 'Kitni door tak (km)',
  noLimit: 'Khaali chhodein to koi seema nahi.',
  errFee: 'Daam ek number hona chahiye, jaise 20.',
  errKm: 'Doori 0.1 se 100 km ke beech honi chahiye.',

  settingsTitle: 'Dukaan settings',
  logoTitle: 'Logo',
  changeLogo: 'Logo badlein',
  removeLogo: 'Logo hatayein',
  logoFailed: 'Logo upload nahi hua. Chhoti photo try karein.',
  logoRemoved: 'Logo hata diya.',
  categoriesTitle: 'Aap kya bechte hain · 3 tak',
  notificationsTitle: 'Notification',
  notificationsBody: 'Jab aas-paas koi aapki cheez maange, to buzz aayega.',
  turnOff: 'Band karein',
  notificationsBlocked: 'Notification band hain. Browser settings mein allow karein.',
  notificationsIos: 'iPhone par pehle is app ko Home Screen par jodein.',
  notificationsFailed: 'Notification chalu nahi hue. Dobara koshish karein.',
  notificationsUnavailable:
    'Ye browser notification nahi dikha sakta. Naye sawaal dekhne ke liye ye page khula rakhein.',
};
