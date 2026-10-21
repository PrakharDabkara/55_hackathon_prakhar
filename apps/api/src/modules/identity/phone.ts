/** Indian mobile → E.164 (`+91XXXXXXXXXX`), or null. Accepts 10 digits with optional +91, 91 or 0 prefix. */
export function normalisePhone(raw: string): string | null {
  const compact = raw.replace(/[\s-]/g, '');
  const match = /^(?:\+91|91|0)?([6-9]\d{9})$/.exec(compact);
  return match ? `+91${match[1]}` : null;
}

/** For logs only: everything but the last 4 digits is hidden. */
export function maskPhone(phone: string): string {
  return `******${phone.slice(-4)}`;
}

/**
 * For the person's own Account screen: "+91 98••• ••210". The country code, the first two digits
 * and the last three, nothing else (ADR-0054). The full number never leaves the server.
 */
export function displayPhone(phone: string): string {
  const digits = phone.slice(3);
  return `+91 ${digits.slice(0, 2)}••• ••${digits.slice(-3)}`;
}
