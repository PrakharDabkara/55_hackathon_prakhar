/**
 * An Indian mobile as people type it: 10 digits starting 6-9, optionally with +91, 91 or 0 in
 * front, spaces and dashes allowed. Returns the 10 digits, or null. Ten of the same digit is
 * refused: nobody owns 9999999999, and it is what a tester types.
 */
export function indianMobile(raw: string): string | null {
  const compact = raw.replace(/[\s-]/g, '');
  const digits = /^(?:\+91|91|0)?([6-9]\d{9})$/.exec(compact)?.[1];
  if (!digits || /^(\d)\1{9}$/.test(digits)) return null;
  return digits;
}
