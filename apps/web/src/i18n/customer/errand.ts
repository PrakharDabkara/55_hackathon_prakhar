import type { ErrandState } from '../../lib/seekerApi.js';

/** Copy for the customer's errand screens (ADR-0042). */
export interface ErrandStrings {
  // The form
  errandTitle: string;
  errandJobLabel: string;
  errandExamplesTitle: string;
  errandBudgetLabel: string;
  errandMakeList: string;
  errandMakingList: string;
  errandUseLocation: string;
  errandDemoLocation: string;
  errandLocationOk: string;
  errandDemoOk: string;
  errandLocationFailed: string;
  errandLocationNeeded: string;
  // Errors
  errandBadBudget: string;
  errandRejected: string;
  errandLimit: string;
  errandNotSeeker: string;
  errandGeneric: string;
  errandGone: string;
  errandLoadFailed: string;
  // A run in flight
  errandState: (state: ErrandState) => string;
  errandProgressTitle: string;
  errandWorking: string;
  errandWaiting: string;
  errandElapsed: (mmss: string) => string;
  errandCancel: string;
  errandNew: string;
  errandFailed: string;
  errandFailedAi: string;
  errandExpired: string;
  errandCancelled: string;
  errandLateTitle: (count: number) => string;
  errandPartial: string;
  // The agent's questions
  listTitle: string;
  listSuggested: string;
  listAiNote: string;
  listAdd: string;
  listAddLabel: string;
  listAsk: (count: number) => string;
  questionTitle: string;
  questionAnswerLabel: string;
  questionSend: string;
  // The plan
  planTitle: string;
  planOptionsLabel: string;
  planSeeOther: string;
  planSeeSuggested: string;
  planCheapest: string;
  planFewest: string;
  planSuggested: string;
  planWhyFewest: (extra: string | null, saved: number) => string;
  planWhyCheapest: (extra: string, saved: number) => string;
  planTilesLabel: string;
  tileShops: string;
  tileRoundTrip: string;
  tileStops: string;
  tileTotal: string;
  tileUnknownPrices: (count: number) => string;
  tileUnknownFees: (count: number) => string;
  planAiNote: string;
  planStartRoute: string;
  planMapLabel: string;
  planYouAreHere: string;
  planFound: (found: number, total: number) => string;
  planNothingYet: string;
  planAskAgain: string;
  planNotFound: string;
  planNotFoundNames: string;
  planStopsLabel: string;
  planStop: (n: number, shop: string) => string;
  planPricesLine: string;
  planDeliveryFee: string;
  planGrandTotal: string;
  planSavings: string;
  stopPickup: string;
  stopDelivers: (fee: string | null) => string;
  stopChoiceLabel: (shop: string) => string;
  stopChoosePickup: string;
  stopChooseDelivery: string;
  itemPriceUnknown: string;
  itemEarlierAnswer: string;
  itemConfirmed: string;
  itemQty: (n: number) => string;
  itemPhotoAlt: string;
}

export const errandEn: ErrandStrings = {
  errandTitle: 'Plan an errand',
  errandJobLabel: "What's the job?",
  errandExamplesTitle: 'Try one of these',
  errandBudgetLabel: 'Budget in ₹ (optional)',
  errandMakeList: 'Make my list',
  errandMakingList: 'Making your list…',
  errandUseLocation: 'Use my location',
  errandDemoLocation: 'Use demo location (Indore)',
  errandLocationOk: 'Got your location.',
  errandDemoOk: 'Using the demo location in Indore.',
  errandLocationFailed: "Couldn't get your location. Use the demo location instead.",
  errandLocationNeeded: 'Pick a location to continue.',
  errandBadBudget: 'Write the budget as a number, like 500 or 450.50.',
  errandRejected: "We couldn't read that as a shopping job. Write what you need to buy.",
  errandLimit: 'You have made a lot of errands. Try again in a little while.',
  errandNotSeeker: 'This number belongs to a shop. Sign in with a customer number.',
  errandGeneric: 'Something went wrong. Try again.',
  errandGone: "We couldn't find this errand. It may be old.",
  errandLoadFailed: "Couldn't load this errand.",
  errandState: (state) =>
    ({
      PLANNING: 'Working on it',
      WAITING_FOR_SHOPS: 'Asking shops',
      NEEDS_INPUT: 'Needs your answer',
      PLAN_READY: 'Plan ready',
      FAILED: 'No plan',
      EXPIRED: 'Time ran out',
      CANCELLED: 'Cancelled',
    })[state],
  errandProgressTitle: 'What has happened',
  errandWorking: 'Working on your errand',
  errandWaiting: 'Waiting for shops to answer',
  errandElapsed: (mmss) => `Time so far ${mmss}`,
  errandCancel: 'Cancel errand',
  errandNew: 'Start a new errand',
  errandFailed: "We couldn't make a plan.",
  errandFailedAi: 'The AI is not available right now. Try again in a little while.',
  errandExpired: 'Time ran out before the plan was ready. Start a new errand.',
  errandCancelled: 'You cancelled this errand.',
  errandLateTitle: (count) => `Late answers (${count})`,
  errandPartial: 'This is what we found before it stopped.',

  listTitle: 'Your list',
  listSuggested: 'Suggested',
  listAiNote:
    'AI made this list and can make mistakes. Check it before we ask shops. Prices always come from the shops, never from AI.',
  listAdd: '+ Add something else',
  listAddLabel: 'Something else',
  listAsk: (count) => `Ask shops for these ${count}`,
  questionTitle: 'A question for you',
  questionAnswerLabel: 'Your answer',
  questionSend: 'Send',

  planTitle: 'Your plan',
  planOptionsLabel: 'Plan options',
  planSeeOther: 'See other options',
  planSeeSuggested: 'Back to the suggested plan',
  planCheapest: 'Cheapest',
  planFewest: 'Fewest stops',
  planSuggested: 'Suggested',
  planWhyFewest: (extra, saved) =>
    `${extra === null ? 'Same price' : `${extra} more`}, ${saved} fewer ${saved === 1 ? 'shop' : 'shops'}`,
  planWhyCheapest: (extra, saved) =>
    `Fewest stops would cost ${extra} more, only ${saved} fewer ${saved === 1 ? 'shop' : 'shops'}`,
  planTilesLabel: 'Plan at a glance',
  tileShops: 'Shops',
  tileRoundTrip: 'Round trip',
  tileStops: 'Stops',
  tileTotal: 'Total',
  tileUnknownPrices: (count) => `+${count} price unknown`,
  tileUnknownFees: (count) => `+${count} delivery fee unknown`,
  planAiNote:
    "AI picked this plan for the shortest trip with every item in stock, using the shops' own answers. It can make mistakes: check the stops before you go.",
  planStartRoute: 'Start route',
  planMapLabel: 'Route map',
  planYouAreHere: 'You are here',
  planFound: (found, total) => `${found} of ${total} ${total === 1 ? 'item' : 'items'} found`,
  planNothingYet: 'No shop has answered yet.',
  planAskAgain: 'Ask shops again',
  planNotFound: 'Not found',
  planNotFoundNames: 'No shop has these yet',
  planStopsLabel: 'Stops in order',
  planStop: (n, shop) => `Stop ${n}: ${shop}`,
  planPricesLine: 'Prices are from the shops.',
  planDeliveryFee: 'Delivery',
  planGrandTotal: 'With delivery',
  planSavings: 'You save',
  stopPickup: 'You pick up',
  stopDelivers: (fee) => (fee === null ? 'Delivers' : `Delivers · ${fee}`),
  stopChoiceLabel: (shop) => `How to get it from ${shop}`,
  stopChoosePickup: 'Pick up',
  stopChooseDelivery: 'Delivery',
  itemPriceUnknown: 'Price unknown',
  itemEarlierAnswer: 'Earlier answer',
  itemConfirmed: 'Confirmed',
  itemQty: (n) => `× ${n}`,
  itemPhotoAlt: "The shop's photo",
};

export const errandHi: ErrandStrings = {
  errandTitle: 'Poora kaam batao',
  errandJobLabel: 'Kya kaam hai?',
  errandExamplesTitle: 'Inme se koi ek chunein',
  errandBudgetLabel: 'Budget ₹ (zaroori nahi)',
  errandMakeList: 'Meri list banao',
  errandMakingList: 'List ban rahi hai…',
  errandUseLocation: 'Meri location use karein',
  errandDemoLocation: 'Demo location (Indore)',
  errandLocationOk: 'Location mil gayi.',
  errandDemoOk: 'Indore ki demo location use ho rahi hai.',
  errandLocationFailed: 'Location nahi mili. Demo location use karein.',
  errandLocationNeeded: 'Aage badhne ke liye location chunein.',
  errandBadBudget: 'Budget number mein likhein, jaise 500 ya 450.50.',
  errandRejected: 'Ye kaam samajh nahi aaya. Bas likhein kya kya lena hai.',
  errandLimit: 'Aapne bahut saare kaam bana liye. Thodi der baad try karein.',
  errandNotSeeker: 'Ye dukaan ka number hai. Customer ke number se login karein.',
  errandGeneric: 'Kuch gadbad ho gayi. Dobara try karein.',
  errandGone: 'Ye kaam nahi mila. Shayad purana hai.',
  errandLoadFailed: 'Ye kaam load nahi hua.',
  errandState: (state) =>
    ({
      PLANNING: 'Kaam chal raha hai',
      WAITING_FOR_SHOPS: 'Dukaanon se pooch rahe hain',
      NEEDS_INPUT: 'Aapka jawab chahiye',
      PLAN_READY: 'Plan taiyaar',
      FAILED: 'Plan nahi bana',
      EXPIRED: 'Time khatam',
      CANCELLED: 'Cancel ho gaya',
    })[state],
  errandProgressTitle: 'Ab tak kya hua',
  errandWorking: 'Aapka kaam chal raha hai',
  errandWaiting: 'Dukaanon ke jawab ka intezaar',
  errandElapsed: (mmss) => `Ab tak ka samay ${mmss}`,
  errandCancel: 'Kaam cancel karein',
  errandNew: 'Naya kaam shuru karein',
  errandFailed: 'Plan nahi ban paya.',
  errandFailedAi: 'AI abhi available nahi hai. Thodi der baad dobara try karein.',
  errandExpired: 'Plan banne se pehle time khatam ho gaya. Naya kaam shuru karein.',
  errandCancelled: 'Aapne ye kaam cancel kar diya.',
  errandLateTitle: (count) => `Baad mein aaye jawab (${count})`,
  errandPartial: 'Rukne se pehle jo mila, wo ye hai.',

  listTitle: 'Aapki list',
  listSuggested: 'Suggested',
  listAiNote:
    'AI ne ye list banayi hai aur isme galti ho sakti hai. Dukaanon se poochne se pehle dekh lein. Daam hamesha dukaanon se aate hain, AI se nahi.',
  listAdd: '+ Kuch aur jodein',
  listAddLabel: 'Kuch aur',
  listAsk: (count) => `Dukaanon se ye ${count} poochein`,
  questionTitle: 'Aapke liye ek sawaal',
  questionAnswerLabel: 'Apna jawab likhein',
  questionSend: 'Bhejo',

  planTitle: 'Aapka plan',
  planOptionsLabel: 'Plan ke vikalp',
  planSeeOther: 'Dusre vikalp dekhein',
  planSeeSuggested: 'Suggested plan par wapas',
  planCheapest: 'Sabse sasta',
  planFewest: 'Kam dukaan',
  planSuggested: 'Suggested',
  planWhyFewest: (extra, saved) =>
    `${extra === null ? 'Same daam' : `${extra} zyada`}, ${saved} dukaan kam`,
  planWhyCheapest: (extra, saved) => `Kam dukaan mein ${extra} zyada lagte, ${saved} dukaan kam`,
  planTilesLabel: 'Plan ek nazar mein',
  tileShops: 'Dukaanein',
  tileRoundTrip: 'Aana-jaana',
  tileStops: 'Padav',
  tileTotal: 'Kul',
  tileUnknownPrices: (count) => `+${count} ka daam pata nahi`,
  tileUnknownFees: (count) => `+${count} ka delivery daam pata nahi`,
  planAiNote:
    'AI ne sabse chhota raasta chuna hai jisme har cheez stock mein ho, dukaanon ke apne jawab se. Isme galti ho sakti hai: jaane se pehle padav dekh lein.',
  planStartRoute: 'Raasta shuru karein',
  planMapLabel: 'Raasta',
  planYouAreHere: 'Aap yahan hain',
  planFound: (found, total) => `${total} mein se ${found} cheezein mili`,
  planNothingYet: 'Abhi kisi dukaan ne jawab nahi diya.',
  planAskAgain: 'Dukaanon se phir poochein',
  planNotFound: 'Nahi mila',
  planNotFoundNames: 'Ye abhi kisi dukaan mein nahi mili',
  planStopsLabel: 'Padav kram se',
  planStop: (n, shop) => `Padav ${n}: ${shop}`,
  planPricesLine: 'Daam dukaanon ke hain.',
  planDeliveryFee: 'Delivery',
  planGrandTotal: 'Delivery ke saath',
  planSavings: 'Aapki bachat',
  stopPickup: 'Aap khud lenge',
  stopDelivers: (fee) => (fee === null ? 'Ghar bhejte hain' : `Ghar bhejte hain · ${fee}`),
  stopChoiceLabel: (shop) => `${shop} se kaise lenge`,
  stopChoosePickup: 'Khud lenge',
  stopChooseDelivery: 'Delivery',
  itemPriceUnknown: 'Daam pata nahi',
  itemEarlierAnswer: 'Pichhla jawab',
  itemConfirmed: 'Confirmed',
  itemQty: (n) => `× ${n}`,
  itemPhotoAlt: 'Dukaan ki photo',
};
