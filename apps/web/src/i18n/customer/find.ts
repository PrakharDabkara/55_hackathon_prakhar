/** Copy for the customer's Find screen, login sheet and follow-up sheet (ADR-0042). */
export interface FindStrings {
  findMyOrders: string;
  findActiveDot: string;
  findNearYou: string;
  findLocationTitle: string;
  findUseMyLocation: string;
  findUseDemo: string;
  findLocationOk: string;
  findDemoOk: string;
  findLocationFailed: string;
  findLocating: string;
  findManualTitle: string;
  findLatitude: string;
  findLongitude: string;
  findDone: string;
  findTitle: string;
  findHint: string;
  findDeliver: string;
  findDeliverHelp: string;
  findAddressLabel: string;
  findDeliverTo: (address: string) => string;
  findChangeAddress: string;
  findAddressNote: string;
  findSubmit: string;
  findSubmitting: string;
  findErrandTitle: string;
  findErrandContinue: string;
  findErrandText: string;
  findShopkeepers: string;
  findStripLabel: string;
  findStatusWaiting: string;
  findStatusAccepted: string;
  findStatusOut: string;
  findStripBy: (shop: string, time: string) => string;
  findTrack: string;
  findOffline: string;
  // The photo button and picker
  findAddPhoto: string;
  findAddPhotoFor: (what: string) => string;
  findRemovePhoto: string;
  findPhotoPreparing: string;
  findPhotoUploading: (percent: number) => string;
  findPhotoAlt: string;
  findPhotoTooLarge: string;
  findPhotoLimit: string;
  findPhotoBad: string;
  findPhotoNetwork: string;
  findPhotoFull: string;
  findPhotoFailed: string;
  // Login sheet
  loginTitle: string;
  loginPhone: string;
  loginSendCode: string;
  loginCode: string;
  loginSubmit: string;
  loginResend: string;
  loginDemoTitle: string;
  loginDemoNote: string;
  loginDemoFill: string;
  loginPrivacy: string;
  // Did you mean? sheet
  askWhich: string;
  askDidYouMean: (name: string) => string;
  askYes: string;
  askAsTyped: (query: string) => string;
  askElse: string;
  askElseHint: string;
  askElseGo: string;
}

export const findEn: FindStrings = {
  findMyOrders: 'My orders',
  findActiveDot: 'You have an order in progress',
  findNearYou: 'Near you',
  findLocationTitle: 'Change location',
  findUseMyLocation: 'Use my location',
  findUseDemo: 'Use demo location (Indore)',
  findLocationOk: 'Location set from your phone.',
  findDemoOk: 'Demo location set (Indore).',
  findLocationFailed: "Couldn't get your location. Enter it below.",
  findLocating: 'Finding your location…',
  findManualTitle: 'Or enter it yourself',
  findLatitude: 'Latitude',
  findLongitude: 'Longitude',
  findDone: 'Done',
  findTitle: 'What do you need?',
  findHint: 'e.g. javitri, 50 g',
  findDeliver: 'Deliver to me',
  findDeliverHelp: 'Shops that deliver will tell you their fee',
  findAddressLabel: 'Delivery address',
  findDeliverTo: (address) => `Deliver to: ${address}`,
  findChangeAddress: 'Change',
  findAddressNote:
    "We'll save this address so you don't type it again. You can delete it from My orders.",
  findSubmit: 'Find nearby',
  findSubmitting: 'Finding…',
  findErrandTitle: 'Plan an errand',
  findErrandContinue: 'Continue your errand',
  findErrandText:
    'For several things. Tell us the job; AI drafts the list, you check it, we ask the shops.',
  findShopkeepers: 'For shopkeepers',
  findStripLabel: 'Order in progress',
  findStatusWaiting: 'Waiting for shop',
  findStatusAccepted: 'Accepted',
  findStatusOut: 'Out for delivery',
  findStripBy: (shop, time) => `${shop} · by ${time}`,
  findTrack: 'Track',
  findOffline: "You're offline. Reconnect to send your request.",
  findAddPhoto: 'Add photo',
  findAddPhotoFor: (what) => `Add photo: ${what}`,
  findRemovePhoto: 'Remove photo',
  findPhotoPreparing: 'Preparing the photo…',
  findPhotoUploading: (percent) => `Uploading ${percent}%`,
  findPhotoAlt: 'Your photo',
  findPhotoTooLarge: 'The photo is too big. Pick a smaller one.',
  findPhotoLimit: "You've added 10 photos today. Try again tomorrow.",
  findPhotoBad: "That photo won't work. Pick a JPEG, PNG or WebP photo.",
  findPhotoNetwork: 'No internet. Please try again.',
  findPhotoFull: "Photos can't be added right now. Carry on without one.",
  findPhotoFailed: 'The photo could not be uploaded. Please try again.',
  loginTitle: 'Log in to send your request',
  loginPhone: 'Mobile number',
  loginSendCode: 'Send code',
  loginCode: '6-digit code',
  loginSubmit: 'Log in',
  loginResend: 'Send a new code',
  loginDemoTitle: 'Demo mode',
  loginDemoNote: 'No SMS is sent. Fill the code from here.',
  loginDemoFill: 'Fill demo OTP',
  loginPrivacy: 'Shops never see your number or name.',
  askWhich: 'Which one do you mean?',
  askDidYouMean: (name) => `Did you mean ${name}?`,
  askYes: 'Yes, this one',
  askAsTyped: (query) => `Search for exactly what I typed: "${query}"`,
  askElse: 'Something else',
  askElseHint: 'Type what you need',
  askElseGo: 'Search again',
};

export const findHi: FindStrings = {
  findMyOrders: 'Mere orders',
  findActiveDot: 'Ek order chal raha hai',
  findNearYou: 'Aapke paas',
  findLocationTitle: 'Location badlein',
  findUseMyLocation: 'Meri location use karein',
  findUseDemo: 'Demo location (Indore)',
  findLocationOk: 'Phone se location mil gayi.',
  findDemoOk: 'Demo location lag gayi (Indore).',
  findLocationFailed: 'Location nahi mili. Neeche khud likhein.',
  findLocating: 'Location dhoondh rahe hain…',
  findManualTitle: 'Ya khud likhein',
  findLatitude: 'Latitude',
  findLongitude: 'Longitude',
  findDone: 'Ho gaya',
  findTitle: 'Kya chahiye?',
  findHint: 'jaise javitri, 50 g',
  findDeliver: 'Ghar mangwao',
  findDeliverHelp: 'Jo dukaan deliver karti hain, wo apna charge batayengi',
  findAddressLabel: 'Ghar ka pata',
  findDeliverTo: (address) => `Delivery ka pata: ${address}`,
  findChangeAddress: 'Badlein',
  findAddressNote:
    'Ye pata hum save kar lenge, dobara nahi likhna padega. Mere orders mein se hata sakte hain.',
  findSubmit: 'Paas mein dhoondho',
  findSubmitting: 'Dhoondh rahe hain…',
  findErrandTitle: 'Kaam ka plan banayein',
  findErrandContinue: 'Apna kaam jaari rakhein',
  findErrandText:
    'Kai cheezon ke liye. Kaam batayein; AI list banata hai, aap dekhein, hum dukaanon se poochte hain.',
  findShopkeepers: 'Dukaandaaron ke liye',
  findStripLabel: 'Order chal raha hai',
  findStatusWaiting: 'Dukaan ke jawab ka intezaar',
  findStatusAccepted: 'Dukaan ne maan liya',
  findStatusOut: 'Delivery ke liye nikla',
  findStripBy: (shop, time) => `${shop} · ${time} tak`,
  findTrack: 'Dekhein',
  findOffline: 'Aap offline hain. Request bhejne ke liye internet jodein.',
  findAddPhoto: 'Photo jodein',
  findAddPhotoFor: (what) => `Photo jodein: ${what}`,
  findRemovePhoto: 'Photo hatayein',
  findPhotoPreparing: 'Photo taiyaar ho rahi hai…',
  findPhotoUploading: (percent) => `Upload ho raha hai ${percent}%`,
  findPhotoAlt: 'Aapki photo',
  findPhotoTooLarge: 'Photo bahut badi hai. Chhoti photo chunein.',
  findPhotoLimit: 'Aaj ke liye 10 photo ho chuki hain. Kal phir jodein.',
  findPhotoBad: 'Ye photo nahi chalegi. JPEG, PNG ya WebP photo chunein.',
  findPhotoNetwork: 'Internet nahi chal raha. Dobara try karein.',
  findPhotoFull: 'Abhi photo nahi le sakte. Bina photo ke aage badhein.',
  findPhotoFailed: 'Photo upload nahi ho payi. Dobara try karein.',
  loginTitle: 'Request bhejne ke liye login karein',
  loginPhone: 'Mobile number',
  loginSendCode: 'OTP bhejo',
  loginCode: '6 ank ka OTP',
  loginSubmit: 'Login karein',
  loginResend: 'Naya OTP bhejo',
  loginDemoTitle: 'Demo mode',
  loginDemoNote: 'Koi SMS nahi jaata. OTP yahan se bharein.',
  loginDemoFill: 'Demo OTP bharein',
  loginPrivacy: 'Dukaan ko aapka number ya naam kabhi nahi dikhta.',
  askWhich: 'Aapka matlab kaun sa hai?',
  askDidYouMean: (name) => `Kya aapka matlab ${name} hai?`,
  askYes: 'Haan, yahi',
  askAsTyped: (query) => `Jo maine likha wahi dhoondho: "${query}"`,
  askElse: 'Kuch aur',
  askElseHint: 'Likhein kya chahiye',
  askElseGo: 'Phir se dhoondho',
};
