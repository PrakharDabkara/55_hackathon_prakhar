/**
 * Values that differ on every run, so a spec passes on a database that earlier runs have used
 * (learned stock, shops with the same name, a new item made last time): each run gets its own
 * shop name and its own new item (the map corner is `newCorner` in orderFlow.ts).
 */
const SYLLABLES = ['ka', 'lo', 'mi', 'ra', 'ne', 'to', 'sa', 'vi', 'du', 'pe'];

/** A random word that reads like a word (vowels in it), e.g. "karamilo". */
export const uniqueWord = (syllables = 4): string =>
  Array.from(
    { length: syllables },
    () => SYLLABLES[Math.floor(Math.random() * SYLLABLES.length)],
  ).join('');

/** A shop name nobody used before, e.g. "Offer Test Kirana karamilo". */
export const uniqueName = (base: string): string => `${base} ${uniqueWord(3)}`;

/**
 * A mobile number nobody used before. The OTP limiter allows only a few requests per phone, so a
 * test logs in each phone once and never reuses a number between tests or runs.
 */
export const uniquePhone = (): string =>
  `98${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
