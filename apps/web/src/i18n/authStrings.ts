/** Copy both login screens and both account screens share (A-01..A-09). */
export interface AuthStrings {
  badPhone: string;
  demoNotice: string;
  demoChips: string;
  changeNumber: string;
  /** After a wrong code: how many guesses remain. */
  triesLeft: (n: number) => string;
  loggedInAs: string;
  showPhone: string;
  hidePhone: string;
}

export const authEn: AuthStrings = {
  badPhone: "That doesn't look like an Indian mobile number.",
  demoNotice: "AskBuy is in demo mode. Real numbers can't receive codes yet.",
  demoChips: 'Tap a demo number to use it',
  changeNumber: 'Change number',
  triesLeft: (n) =>
    n <= 0 ? 'No tries left. Ask for a new code.' : n === 1 ? '1 try left.' : `${n} tries left.`,
  loggedInAs: 'Logged in as',
  showPhone: 'Show phone number',
  hidePhone: 'Hide phone number',
};

export const authHi: AuthStrings = {
  badPhone: 'Ye Indian mobile number jaisa nahi lag raha.',
  demoNotice: 'AskBuy abhi demo mode mein hai. Asli numbers par abhi code nahi aa sakta.',
  demoChips: 'Demo number chunne ke liye dabayein',
  changeNumber: 'Number badlein',
  triesLeft: (n) =>
    n <= 0 ? 'Koi koshish baaki nahi. Naya code mangwayein.' : `${n} koshish baaki.`,
  loggedInAs: 'Is number se login',
  showPhone: 'Phone number dikhayein',
  hidePhone: 'Phone number chhupayein',
};
