/** Copy for order tracking and My orders (ADR-0042). */
export interface OrdersStrings {
  // Order page
  orderTitle: string;
  orderFrom: (shop: string) => string;
  capRequested: string;
  capAccepted: string;
  capOut: string;
  capDelivered: string;
  reachingBy: (time: string) => string;
  outSince: (time: string) => string;
  ownPerson: string;
  stepPlaced: string;
  stepAccepted: string;
  stepOut: string;
  stepReceived: string;
  stepsLabel: string;
  itemsTitle: string;
  feeLabel: string;
  freeDelivery: string;
  orderPayCash: (amount: string) => string;
  priceUnknownMore: (n: number) => string;
  priceUnknown: string;
  received: string;
  cancelOrder: string;
  cancelSheetTitle: string;
  cancelReasonLabel: string;
  cancelReasonHelp: string;
  cancelKeep: string;
  cannotCancelOut: string;
  notConfirmed: string;
  notConfirmedHelp: string;
  cancelledByYou: string;
  cancelledByShop: string;
  reasonOutOfStock: string;
  reasonCannotDeliver: string;
  reasonOther: string;
  declined: string;
  expired: string;
  seeShops: string;
  addressTitle: string;
  addressGone: string;
  noteTitle: string;
  orderNotFound: string;
  orderActionFailed: string;
  // My orders
  myOrdersTitle: string;
  activeTitle: string;
  errandsTitle: string;
  earlierTitle: string;
  byTime: (time: string) => string;
  statusDelivered: string;
  statusNotConfirmed: string;
  statusCancelledShop: string;
  statusCancelledYou: string;
  statusDeclined: string;
  statusExpired: string;
  moreItems: (n: number) => string;
  emptyTitle: string;
  emptyHelp: string;
  emptyCta: string;
  savedTitle: string;
  savedHelp: string;
  savedDelete: string;
  savedDeleted: string;
  // "Did you get it?"
  pickupQuestion: (item: string, shop: string) => string;
  pickupHelp: string;
  pickupFound: string;
  pickupNotThere: string;
  pickupNotGone: string;
  pickupThanks: string;
  pickupError: string;
  // Notifications
  notifyTitle: string;
  notifyOffHelp: string;
  notifyOnHelp: string;
  notifyIosHint: string;
  notifyBlocked: string;
  notifyFailed: string;
}

export const ordersEn: OrdersStrings = {
  orderTitle: 'Your order',
  orderFrom: (shop) => `From ${shop}`,
  capRequested: 'Waiting for the shop',
  capAccepted: 'Shop accepted',
  capOut: 'Out for delivery',
  capDelivered: 'Delivered',
  reachingBy: (time) => `Reaching by ${time}`,
  outSince: (time) => `Out for delivery since ${time}`,
  ownPerson: "The shop's own person is bringing it.",
  stepPlaced: 'Order placed',
  stepAccepted: 'Shop accepted',
  stepOut: 'Out for delivery',
  stepReceived: 'Received',
  stepsLabel: 'Progress',
  itemsTitle: 'Items',
  feeLabel: 'Delivery fee',
  freeDelivery: 'Free',
  orderPayCash: (amount) => `Pay cash ${amount}`,
  priceUnknownMore: (n) => `+${n} price unknown`,
  priceUnknown: 'Ask the shop for the price',
  received: 'I received it',
  cancelOrder: 'Cancel order',
  cancelSheetTitle: 'Cancel this order?',
  cancelReasonLabel: 'Reason for the shop (optional)',
  cancelReasonHelp: 'Up to 140 characters.',
  cancelKeep: 'Keep order',
  cannotCancelOut: "It's out for delivery, so it can't be cancelled now.",
  notConfirmed: "You didn't confirm delivery",
  notConfirmedHelp: 'The order ended because it was not marked as received in time.',
  cancelledByYou: 'You cancelled this order',
  cancelledByShop: 'The shop cancelled this order',
  reasonOutOfStock: 'Out of stock',
  reasonCannotDeliver: "Can't deliver right now",
  reasonOther: 'Another reason',
  declined: 'The shop said no. You can pick it up yourself.',
  expired: "The shop didn't answer in time. You can pick it up yourself.",
  seeShops: 'See the shops',
  addressTitle: 'Delivery address',
  addressGone: 'The address is removed after 30 days.',
  noteTitle: 'Your note',
  orderNotFound: "We couldn't find this order.",
  orderActionFailed: "That didn't go through. Check the order and try again.",
  myOrdersTitle: 'My orders',
  activeTitle: 'Active',
  errandsTitle: 'Errands',
  earlierTitle: 'Earlier',
  byTime: (time) => `by ${time}`,
  statusDelivered: 'Delivered',
  statusNotConfirmed: "You didn't confirm",
  statusCancelledShop: 'Cancelled by shop',
  statusCancelledYou: 'Cancelled by you',
  statusDeclined: 'Shop declined',
  statusExpired: 'No answer from shop',
  moreItems: (n) => `+${n} more`,
  emptyTitle: 'No orders yet.',
  emptyHelp: 'Orders you place from a request show up here.',
  emptyCta: 'Find an item',
  savedTitle: 'Saved address',
  savedHelp: 'used for delivery',
  savedDelete: 'Delete',
  savedDeleted: 'Deleted',
  pickupQuestion: (item, shop) => `Did you get ${item} at ${shop}?`,
  pickupHelp: 'Your answer helps the next person nearby.',
  pickupFound: 'Got it',
  pickupNotThere: "Wasn't there",
  pickupNotGone: "Didn't go",
  pickupThanks: 'Thanks! Your answer helps the next person nearby.',
  pickupError: "We couldn't send your answer. Try again.",
  notifyTitle: 'Notifications',
  notifyOffHelp: 'Get told when a shop answers or your order moves.',
  notifyOnHelp: 'On for this device.',
  notifyIosHint: "First tap Share, then 'Add to Home Screen'.",
  notifyBlocked: 'Blocked. Allow notifications in your browser settings.',
  notifyFailed: "We couldn't turn notifications on. Try again.",
};

export const ordersHi: OrdersStrings = {
  orderTitle: 'Aapka order',
  orderFrom: (shop) => `${shop} se`,
  capRequested: 'Dukaan ke jawab ka intezaar',
  capAccepted: 'Dukaan ne order le liya',
  capOut: 'Raste mein hai',
  capDelivered: 'Pahunch gaya',
  reachingBy: (time) => `${time} tak pahunchega`,
  outSince: (time) => `${time} se raste mein hai`,
  ownPerson: 'Dukaan ka apna aadmi la raha hai.',
  stepPlaced: 'Order diya',
  stepAccepted: 'Dukaan ne le liya',
  stepOut: 'Raste mein',
  stepReceived: 'Mil gaya',
  stepsLabel: 'Progress',
  itemsTitle: 'Saaman',
  feeLabel: 'Delivery charge',
  freeDelivery: 'Free',
  orderPayCash: (amount) => `Cash dein ${amount}`,
  priceUnknownMore: (n) => `+${n} ka daam pata nahi`,
  priceUnknown: 'Daam dukaan se poochein',
  received: 'Mujhe mil gaya',
  cancelOrder: 'Order cancel karein',
  cancelSheetTitle: 'Order cancel karein?',
  cancelReasonLabel: 'Dukaan ke liye wajah (zaroori nahi)',
  cancelReasonHelp: 'Zyada se zyada 140 akshar.',
  cancelKeep: 'Order rehne dein',
  cannotCancelOut: 'Order raste mein hai, abhi cancel nahi ho sakta.',
  notConfirmed: 'Aapne delivery confirm nahi ki',
  notConfirmedHelp: 'Order samay par mil gaya mark nahi hua, isliye band ho gaya.',
  cancelledByYou: 'Aapne ye order cancel kiya',
  cancelledByShop: 'Dukaan ne ye order cancel kiya',
  reasonOutOfStock: 'Stock mein nahi hai',
  reasonCannotDeliver: 'Abhi delivery nahi ho sakti',
  reasonOther: 'Koi aur wajah',
  declined: 'Dukaan ne mana kiya. Aap khud jaakar le sakte hain.',
  expired: 'Dukaan ne samay par jawab nahi diya. Aap khud jaakar le sakte hain.',
  seeShops: 'Dukaan dekhein',
  addressTitle: 'Delivery ka pata',
  addressGone: 'Pata 30 din baad hata diya jaata hai.',
  noteTitle: 'Aapka note',
  orderNotFound: 'Ye order nahi mila.',
  orderActionFailed: 'Ye nahi ho paaya. Order dekhein aur phir try karein.',
  myOrdersTitle: 'Mere orders',
  activeTitle: 'Chal rahe',
  errandsTitle: 'Kaam',
  earlierTitle: 'Pehle ke',
  byTime: (time) => `${time} tak`,
  statusDelivered: 'Pahunch gaya',
  statusNotConfirmed: 'Aapne confirm nahi kiya',
  statusCancelledShop: 'Dukaan ne cancel kiya',
  statusCancelledYou: 'Aapne cancel kiya',
  statusDeclined: 'Dukaan ne mana kiya',
  statusExpired: 'Dukaan ka jawab nahi aaya',
  moreItems: (n) => `+${n} aur`,
  emptyTitle: 'Abhi koi order nahi.',
  emptyHelp: 'Request se jo order denge, wo yahan dikhenge.',
  emptyCta: 'Cheez dhoondhein',
  savedTitle: 'Yaad rakha hua pata',
  savedHelp: 'delivery ke liye',
  savedDelete: 'Hatayein',
  savedDeleted: 'Hata diya',
  pickupQuestion: (item, shop) => `Kya aapko ${item} ${shop} par mila?`,
  pickupHelp: 'Aapke jawab se agle vyakti ko madad milti hai.',
  pickupFound: 'Mil gaya',
  pickupNotThere: 'Wahan nahi tha',
  pickupNotGone: 'Gaya nahi',
  pickupThanks: 'Shukriya! Aapke jawab se agle vyakti ko madad milegi.',
  pickupError: 'Jawab nahi bhej paaye. Dobara try karein.',
  notifyTitle: 'Notification',
  notifyOffHelp: 'Dukaan ka jawab ya order ka update milne par bataya jayega.',
  notifyOnHelp: 'Is device par chalu hai.',
  notifyIosHint: "Pehle Share dabayein, phir 'Add to Home Screen'.",
  notifyBlocked: 'Band hain. Browser ki settings mein allow karein.',
  notifyFailed: 'Notification chalu nahi ho paaye. Dobara try karein.',
};
