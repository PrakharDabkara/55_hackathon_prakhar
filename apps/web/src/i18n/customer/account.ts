/** Copy for the Account screen (ADR-0054). */
export interface AccountStrings {
  accountOpen: string;
  accountTitle: string;
  accountLoggedInAs: string;
  accountLoadFailed: string;
  accountRetry: string;
  accountAddressHeading: string;
  accountNoAddress: string;
  accountAddAddress: string;
  accountEditAddress: string;
  accountEditSheet: string;
  accountAddressLabel: string;
  accountAddressSave: string;
  accountAddressTooShort: string;
  accountAddressSaveFailed: string;
  accountAddressNote: string;
  accountSettings: string;
  accountAlerts: string;
  accountAlertsNote: string;
  accountAlertsBlocked: string;
  accountAlertsUnavailable: string;
  accountAppearance: string;
  accountThemeSystem: string;
  accountThemeLight: string;
  accountThemeDark: string;
  accountWhatShopsSee: string;
  accountSeeIntro: string;
  accountSeeNever: string;
  accountSeeOrder: string;
  accountLogout: string;
  accountDelete: string;
  accountDeleteTitle: string;
  accountDeleteBody: string;
  accountDeleteConfirm: string;
  accountDeleteCancel: string;
  accountDeleteOpenOrder: string;
  accountDeleteFailed: string;
  accountDeleteTooMany: string;
  accountShopkeeper: string;
  accountShopApp: string;
}

export const accountEn: AccountStrings = {
  accountOpen: 'Account',
  accountTitle: 'Account',
  accountLoggedInAs: 'Logged in as',
  accountLoadFailed: "Couldn't load your account. Check your connection and try again.",
  accountRetry: 'Try again',
  accountAddressHeading: 'Delivery address',
  accountNoAddress: 'No address yet',
  accountAddAddress: 'Add address',
  accountEditAddress: 'Edit',
  accountEditSheet: 'Edit address',
  accountAddressLabel: 'Address',
  accountAddressSave: 'Save',
  accountAddressTooShort: 'Enter your full address, at least 5 characters.',
  accountAddressSaveFailed: "Couldn't save the address. Try again.",
  accountAddressNote: 'Used only for deliveries. A shop sees it only after you choose them.',
  accountSettings: 'Settings',
  accountAlerts: 'Reply alerts',
  accountAlertsNote: 'A notification when a shop answers',
  accountAlertsBlocked: 'Blocked in your browser settings',
  accountAlertsUnavailable: 'Not available on this device',
  accountAppearance: 'Appearance',
  accountThemeSystem: 'System',
  accountThemeLight: 'Light',
  accountThemeDark: 'Dark',
  accountWhatShopsSee: 'What shops can see',
  accountSeeIntro:
    'When you search, shops see the item and how many, the price you want to beat if you set one, a photo if you add one, roughly how far away you are (like "under 1 km"), and whether you want delivery.',
  accountSeeNever:
    'They never see your phone number, and never your exact location until they accept an order.',
  accountSeeOrder:
    'If you choose a shop for delivery, it sees what you ordered, a first name if you typed one, and any note you write. After it accepts, it also sees your address and a map pin of your location.',
  accountLogout: 'Log out',
  accountDelete: 'Delete my account',
  accountDeleteTitle: 'Delete your account?',
  accountDeleteBody:
    "Your phone number, address and alerts are removed and you're logged out. Shops keep their past order records, without your number.",
  accountDeleteConfirm: 'Delete account',
  accountDeleteCancel: 'Cancel',
  accountDeleteOpenOrder: 'Finish or cancel your open order first.',
  accountDeleteFailed: "Couldn't delete your account. Check your connection and try again.",
  accountDeleteTooMany: 'Too many tries. Try again in an hour.',
  accountShopkeeper: 'Shopkeeper?',
  accountShopApp: 'Open the shop app',
};

export const accountHi: AccountStrings = {
  accountOpen: 'Account',
  accountTitle: 'Account',
  accountLoggedInAs: 'Is number se login',
  accountLoadFailed: 'Account nahi khul paya. Internet check karke dobara try karein.',
  accountRetry: 'Dobara try karein',
  accountAddressHeading: 'Delivery ka pata',
  accountNoAddress: 'Abhi koi pata nahi',
  accountAddAddress: 'Pata jodein',
  accountEditAddress: 'Badlein',
  accountEditSheet: 'Pata badlein',
  accountAddressLabel: 'Pata',
  accountAddressSave: 'Save karein',
  accountAddressTooShort: 'Poora pata likhein, kam se kam 5 akshar.',
  accountAddressSaveFailed: 'Pata save nahi hua. Dobara try karein.',
  accountAddressNote:
    'Sirf delivery ke liye. Dukaan ko yeh tabhi dikhta hai jab aap use chunte hain.',
  accountSettings: 'Settings',
  accountAlerts: 'Jawab ke alerts',
  accountAlertsNote: 'Dukaan jawab de to notification aayega',
  accountAlertsBlocked: 'Browser ki settings mein band hai',
  accountAlertsUnavailable: 'Is device par nahi chalega',
  accountAppearance: 'Rang-roop',
  accountThemeSystem: 'Phone jaisa',
  accountThemeLight: 'Halka',
  accountThemeDark: 'Gehra',
  accountWhatShopsSee: 'Dukaan kya dekhti hai',
  accountSeeIntro:
    'Search karne par dukaan ko item aur kitna chahiye, aapka target daam (agar diya), photo (agar jodi), aap lagbhag kitni door hain ("1 km se kam") aur delivery chahiye ya nahi, yeh dikhta hai.',
  accountSeeNever:
    'Aapka phone number unhe kabhi nahi dikhta, aur order accept hone se pehle aapki asli location bhi nahi.',
  accountSeeOrder:
    'Delivery ke liye dukaan chunne par use order ka saaman, pehla naam (agar likha) aur aapka note dikhta hai. Accept karne ke baad aapka pata aur location ka map pin bhi dikhta hai.',
  accountLogout: 'Logout karein',
  accountDelete: 'Mera account delete karein',
  accountDeleteTitle: 'Account delete karein?',
  accountDeleteBody:
    'Aapka phone number, pata aur alerts hata diye jaayenge aur aap logout ho jaayenge. Dukaanon ke paas purane orders ka record bina aapke number ke rahega.',
  accountDeleteConfirm: 'Account delete karein',
  accountDeleteCancel: 'Rehne dein',
  accountDeleteOpenOrder: 'Pehle apna khula order poora ya cancel karein.',
  accountDeleteFailed: 'Account delete nahi hua. Internet check karke dobara try karein.',
  accountDeleteTooMany: 'Bahut koshishein ho gayi. Ek ghante baad try karein.',
  accountShopkeeper: 'Dukaandaar hain?',
  accountShopApp: 'Shop app kholein',
};
