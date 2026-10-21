/** Copy for shopping lists in the customer app: the editor, the check, the replies, the plan, the orders (ADR-0055). */
export interface ListsStrings {
  // Find
  findModeLabel: string;
  findModeOne: string;
  findModeList: string;
  findMakeList: string;
  listFind: (lines: number) => string;
  listSorting: string;
  listEditorLabel: string;
  listEnterHint: string;
  listCount: (n: number, max: number) => string;
  listCut: (max: number) => string;
  listModeNote: string;
  listNextItem: string;
  listItemN: (n: number) => string;
  listRemove: (text: string) => string;
  listErrTooLong: string;
  listErrTooMany: string;
  listErrRate: string;
  listErrGeneric: string;
  // Check your list
  checkTitle: string;
  checkAsTyped: string;
  checkOther: string;
  checkOtherNote: string;
  checkBlocked: string;
  checkUnclear: string;
  checkEdit: string;
  checkAiNote: string;
  checkSend: string;
  checkSending: string;
  checkChoose: (text: string) => string;
  checkNothing: string;
  checkChooseAll: string;
  checkRate: string;
  checkGeneric: string;
  checkNoPlace: string;
  // Replies
  listTitle: string;
  listNotFound: string;
  listSent: (shops: number, items: number) => string;
  listAnswered: (n: number) => string;
  listStatusListening: (answered: string, minutes: number | null) => string;
  listStatusFull: (answered: string) => string;
  listStatusEnded: (answered: string) => string;
  listStatusStopped: (answered: string) => string;
  listWaiting: string;
  listAnswersHeading: string;
  listDelivers: (fee: string | null, free: boolean) => string;
  listPickupOnly: string;
  listHaveOf: (have: number, total: number) => string;
  listLineNo: string;
  listLineNotSold: string;
  listSrHave: string;
  listCoverFull: (shops: number, total: number) => string;
  listCoverPartial: (covered: number, total: number) => string;
  listMakePlan: string;
  listStoppedNote: string;
  // Stop asking
  stopTitle: string;
  stopBodyList: string;
  stopBodyRequest: string;
  stopConfirm: string;
  stopKeep: string;
  stopFailed: string;
  // Plan
  planTitle: string;
  planTotals: string;
  planShops: string;
  planItems: string;
  planCash: string;
  planOfTotal: (covered: number, total: number) => string;
  planMapLabel: string;
  planItemCount: (n: number) => string;
  planPickup: string;
  planDeliver: (fee: string | null, free: boolean) => string;
  planNoDeliver: string;
  planModeLabel: (shop: string) => string;
  planMoveTitle: (line: string) => string;
  planMoveHelp: string;
  planMissingTitle: string;
  planMissingHelp: string;
  planFeeUnknown: (n: number) => string;
  planOrder: (shops: number) => string;
  planOrdering: string;
  planOrderNote: string;
  planDeliveryHeading: string;
  planErrClosed: string;
  planErrCannotDeliver: string;
  planErrNotAvailable: string;
  planErrStopped: string;
  planErrAddress: string;
  planErrGeneric: string;
  // Orders of a list, and pickup orders
  listOrdersTitle: string;
  listPacked: (done: number, total: number) => string;
  capReady: string;
  capCollected: string;
  stepReady: string;
  stepCollected: string;
  directions: string;
  pickupCod: string;
  pickupShop: string;
  pickupCollect: string;
  // My orders
  myListRow: (items: number) => string;
  myListShops: (n: number) => string;
  statusCollected: string;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const listsEn: ListsStrings = {
  findModeLabel: 'What to find',
  findModeOne: 'One thing',
  findModeList: 'A list',
  findMakeList: 'Several things? Make it a list',
  listFind: (n) =>
    n === 0 ? 'Find these nearby' : n === 1 ? 'Find 1 item nearby' : `Find these ${n} nearby`,
  listSorting: 'Reading your list…',
  listEditorLabel: 'Your list',
  listEnterHint: 'Enter adds the next line',
  listCount: (n, max) => `${n} of ${max}`,
  listCut: (max) => `Only the first ${max} were kept.`,
  listModeNote: 'Pick up or delivery: you choose for each shop once they answer.',
  listNextItem: 'Next item',
  listItemN: (n) => `Item ${n}`,
  listRemove: (text) => `Remove ${text}`,
  listErrTooLong: 'Keep each item under 80 characters.',
  listErrTooMany: 'A list has at most 10 items.',
  listErrRate: "You've sent several lists this hour. Try again a bit later.",
  listErrGeneric: "Couldn't read your list. Check your connection and try again.",
  checkTitle: 'Check your list',
  checkAsTyped: 'As I typed',
  checkOther: 'Other',
  checkOtherNote: "Not in our list: we'll ask every shop nearby",
  checkBlocked: "We can't ask shops for this",
  checkUnclear: 'Not clear enough: edit it',
  checkEdit: 'Edit list',
  checkAiNote:
    'AI sorted your list and can make mistakes. Shops see only the items they sell, plus any Other items. Never your name or number.',
  checkSend: 'Ask shops nearby',
  checkSending: 'Sending…',
  checkChoose: (text) => `Choose one for “${text}”.`,
  checkNothing: 'Nothing here can be sent. Edit your list.',
  checkChooseAll: 'Choose one for each question first.',
  checkRate: "You've sent several lists this hour. Try again a bit later.",
  checkGeneric: "Couldn't send your list. Check your connection and try again.",
  checkNoPlace: 'We need your location to find shops. Allow it, or set a place on Find.',
  listTitle: 'Your list',
  listNotFound: "We can't find this list.",
  listSent: (shops, items) =>
    `Sent to ${plural(shops, 'shop', 'shops')} · ${plural(items, 'item', 'items')}`,
  listAnswered: (n) =>
    n === 0 ? 'No shop has answered yet' : `${plural(n, 'shop', 'shops')} answered`,
  listStatusListening: (answered, minutes) =>
    `${answered} · still listening for ${minutes === null ? 'less than a minute' : `${minutes} min`}`,
  listStatusFull: (answered) => `Enough answers · ${answered}`,
  listStatusEnded: (answered) => `Listening ended · ${answered}`,
  listStatusStopped: (answered) => `You stopped asking · ${answered}`,
  listWaiting: 'Waiting for shops… usually 1–3 minutes',
  listAnswersHeading: 'Answers',
  listDelivers: (fee, free) => (free ? 'delivers free' : fee ? `delivers, ${fee}` : 'delivers'),
  listPickupOnly: 'pick up only',
  listHaveOf: (have, total) => `${have} of ${total}`,
  listLineNo: "Doesn't have",
  listLineNotSold: "Doesn't sell",
  listSrHave: 'Has it',
  listCoverFull: (shops, total) =>
    `Every item has a shop. ${shops} ${shops === 1 ? 'shop covers' : 'shops cover'} all ${total}.`,
  listCoverPartial: (covered, total) => `${covered} of ${total} items have a shop so far`,
  listMakePlan: 'Make my plan',
  listStoppedNote: "You can't order from a list you stopped. Start a new one.",
  stopTitle: 'Stop asking shops?',
  stopBodyList:
    "Shops that haven't answered won't be asked any more. You won't be able to order from this list.",
  stopBodyRequest:
    "Shops that haven't answered won't be asked any more. Answers you already have stay here.",
  stopConfirm: 'Stop asking',
  stopKeep: 'Keep waiting',
  stopFailed: "Couldn't stop. Check your connection and try again.",
  planTitle: 'Your plan',
  planTotals: 'Plan totals',
  planShops: 'Shops',
  planItems: 'Items',
  planCash: 'Cash',
  planOfTotal: (covered, total) => `${covered} of ${total}`,
  planMapLabel: 'Route to the shops',
  planItemCount: (n) => plural(n, 'item', 'items'),
  planPickup: 'Pick up',
  planDeliver: (fee, free) => (free ? 'Deliver · free' : fee ? `Deliver · ${fee}` : 'Deliver'),
  planNoDeliver: "Doesn't deliver",
  planModeLabel: (shop) => `Pick up or delivery for ${shop}`,
  planMoveTitle: (line) => `Move ${line}`,
  planMoveHelp: 'Other shops that have it:',
  planMissingTitle: 'Nobody has this yet',
  planMissingHelp: 'No shop said yes to these. Try again later.',
  planFeeUnknown: (n) =>
    `${plural(n, 'shop has', 'shops have')} not named a delivery fee. It is not in the total.`,
  planOrder: (shops) => `Order from ${plural(shops, 'shop', 'shops')} · pay cash`,
  planOrdering: 'Placing orders…',
  planOrderNote: 'Each shop gets its own order. Prices are fixed once you order.',
  planDeliveryHeading: 'Delivery',
  planErrClosed: 'A shop on your plan just closed. Move its items to another shop.',
  planErrCannotDeliver: "A shop can't deliver right now. Pick up instead, or move its items.",
  planErrNotAvailable: 'A shop no longer has one of your items. Move it to another shop.',
  planErrStopped: 'You stopped this list, so it can no longer be ordered. Start a new list.',
  planErrAddress: 'Add a delivery address first.',
  planErrGeneric: "Couldn't place the orders. Check your connection and try again.",
  listOrdersTitle: 'Your orders',
  listPacked: (done, total) => `Being packed · ${done} of ${total}`,
  capReady: 'Ready for pickup',
  capCollected: 'Collected',
  stepReady: 'Ready for pickup',
  stepCollected: 'Collected',
  directions: 'Directions',
  pickupCod: 'You pick it up at the shop and pay cash there.',
  pickupShop: 'Shop location',
  pickupCollect: 'Pick it up before the shop closes.',
  myListRow: (items) => `List · ${plural(items, 'item', 'items')}`,
  myListShops: (n) => plural(n, 'shop', 'shops'),
  statusCollected: 'Collected',
};

export const listsHi: ListsStrings = {
  findModeLabel: 'Kya dhoondhna hai',
  findModeOne: 'Ek cheez',
  findModeList: 'Ek list',
  findMakeList: 'Kai cheezein? List bana lein',
  listFind: (n) =>
    n === 0
      ? 'Ye paas mein dhoondho'
      : n === 1
        ? '1 cheez paas mein dhoondho'
        : `Ye ${n} paas mein dhoondho`,
  listSorting: 'Aapki list padh rahe hain…',
  listEditorLabel: 'Aapki list',
  listEnterHint: 'Enter se agli line banti hai',
  listCount: (n, max) => `${n} / ${max}`,
  listCut: (max) => `Sirf pehli ${max} rakhi gayin.`,
  listModeNote: 'Pickup ya delivery: dukaan ke jawab ke baad har dukaan ke liye chunein.',
  listNextItem: 'Agli cheez',
  listItemN: (n) => `Cheez ${n}`,
  listRemove: (text) => `${text} hatayein`,
  listErrTooLong: 'Har cheez 80 akshar se kam rakhein.',
  listErrTooMany: 'Ek list mein zyada se zyada 10 cheezein.',
  listErrRate: 'Aapne is ghante kai list bhej di hain. Thodi der baad try karein.',
  listErrGeneric: 'List padh nahi payi. Internet check karein aur phir try karein.',
  checkTitle: 'Apni list dekh lein',
  checkAsTyped: 'Jaisa maine likha',
  checkOther: 'Anya',
  checkOtherNote: 'Hamari list mein nahi hai: paas ki har dukaan se poochenge',
  checkBlocked: 'Ye dukaanon se nahi pooch sakte',
  checkUnclear: 'Saaf nahi hai: badal dein',
  checkEdit: 'List badlein',
  checkAiNote:
    'AI ne list chhanti hai aur galti kar sakta hai. Dukaan sirf wahi cheezein dekhti hai jo wo bechti hai, aur Anya cheezein. Aapka naam ya number kabhi nahi.',
  checkSend: 'Paas ki dukaanon se poochein',
  checkSending: 'Bhej rahe hain…',
  checkChoose: (text) => `“${text}” ke liye ek chunein.`,
  checkNothing: 'Yahan se kuch bheja nahi ja sakta. List badlein.',
  checkChooseAll: 'Pehle har sawaal ke liye ek chunein.',
  checkRate: 'Aapne is ghante kai list bhej di hain. Thodi der baad try karein.',
  checkGeneric: 'List nahi bheji ja saki. Internet check karein aur phir try karein.',
  checkNoPlace:
    'Dukaan dhoondhne ke liye aapki jagah chahiye. Ijazat dein, ya Find par jagah chunein.',
  listTitle: 'Aapki list',
  listNotFound: 'Ye list nahi mili.',
  listSent: (shops, items) => `${shops} dukaanon ko bheji · ${items} cheezein`,
  listAnswered: (n) =>
    n === 0 ? 'Abhi kisi dukaan ne jawab nahi diya' : `${n} dukaanon ne jawab diya`,
  listStatusListening: (answered, minutes) =>
    `${answered} · abhi ${minutes === null ? 'ek minute se kam' : `${minutes} min`} aur sun rahe hain`,
  listStatusFull: (answered) => `Kaafi jawab aa gaye · ${answered}`,
  listStatusEnded: (answered) => `Sunna band · ${answered}`,
  listStatusStopped: (answered) => `Aapne poochna band kiya · ${answered}`,
  listWaiting: 'Dukaanon ka intezaar… aam taur par 1–3 minute',
  listAnswersHeading: 'Jawab',
  listDelivers: (fee, free) => (free ? 'free delivery' : fee ? `delivery, ${fee}` : 'delivery hai'),
  listPickupOnly: 'sirf pickup',
  listHaveOf: (have, total) => `${have} / ${total}`,
  listLineNo: 'Nahi hai',
  listLineNotSold: 'Nahi bechte',
  listSrHave: 'Hai',
  listCoverFull: (shops, total) =>
    `Har cheez ke liye dukaan hai. ${shops} dukaanein sab ${total} deti hain.`,
  listCoverPartial: (covered, total) =>
    `${total} mein se ${covered} cheezon ke liye abhi dukaan hai`,
  listMakePlan: 'Mera plan banayein',
  listStoppedNote: 'Band ki hui list se order nahi ho sakta. Nayi list banayein.',
  stopTitle: 'Dukaanon se poochna band karein?',
  stopBodyList:
    'Jinhone jawab nahi diya unse ab nahi poochenge. Is list se order nahi kar payenge.',
  stopBodyRequest:
    'Jinhone jawab nahi diya unse ab nahi poochenge. Jo jawab aa chuke hain wo yahin rahenge.',
  stopConfirm: 'Poochna band karein',
  stopKeep: 'Intezaar karein',
  stopFailed: 'Band nahi hua. Internet check karein aur phir try karein.',
  planTitle: 'Aapka plan',
  planTotals: 'Plan ka hisaab',
  planShops: 'Dukaanein',
  planItems: 'Cheezein',
  planCash: 'Cash',
  planOfTotal: (covered, total) => `${total} mein se ${covered}`,
  planMapLabel: 'Dukaanon tak ka raasta',
  planItemCount: (n) => `${n} cheez`,
  planPickup: 'Pickup',
  planDeliver: (fee, free) => (free ? 'Delivery · free' : fee ? `Delivery · ${fee}` : 'Delivery'),
  planNoDeliver: 'Delivery nahi karte',
  planModeLabel: (shop) => `${shop} ke liye pickup ya delivery`,
  planMoveTitle: (line) => `${line} dusri dukaan se lein`,
  planMoveHelp: 'Ye aur kahan milta hai:',
  planMissingTitle: 'Ye abhi kisi ke paas nahi',
  planMissingHelp: 'In par kisi dukaan ne haan nahi kaha. Baad mein phir try karein.',
  planFeeUnknown: (n) => `${n} dukaan ne delivery fee nahi batayi. Wo total mein nahi hai.`,
  planOrder: (shops) => `${shops} dukaanon se order karein · cash`,
  planOrdering: 'Order ho rahe hain…',
  planOrderNote: 'Har dukaan ko apna order milta hai. Order ke baad daam pakke ho jaate hain.',
  planDeliveryHeading: 'Delivery',
  planErrClosed: 'Aapke plan ki ek dukaan abhi band ho gayi. Uski cheezein dusri dukaan se lein.',
  planErrCannotDeliver:
    'Ek dukaan abhi delivery nahi kar sakti. Pickup chunein, ya uski cheezein dusri dukaan se lein.',
  planErrNotAvailable: 'Ek dukaan ke paas aapki ek cheez ab nahi hai. Use dusri dukaan se lein.',
  planErrStopped: 'Aapne ye list band kar di, ab isse order nahi ho sakta. Nayi list banayein.',
  planErrAddress: 'Pehle delivery ka pata likhein.',
  planErrGeneric: 'Order nahi ho paye. Internet check karein aur phir try karein.',
  listOrdersTitle: 'Aapke order',
  listPacked: (done, total) => `Pack ho raha hai · ${total} mein se ${done}`,
  capReady: 'Pickup ke liye taiyaar',
  capCollected: 'Le liya',
  stepReady: 'Pickup ke liye taiyaar',
  stepCollected: 'Le liya',
  directions: 'Raasta',
  pickupCod: 'Aap dukaan se le jayenge aur wahin cash denge.',
  pickupShop: 'Dukaan ki jagah',
  pickupCollect: 'Dukaan band hone se pehle le jayein.',
  myListRow: (items) => `List · ${items} cheezein`,
  myListShops: (n) => `${n} dukaanein`,
  statusCollected: 'Le liya',
};
