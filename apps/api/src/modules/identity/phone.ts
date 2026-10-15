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
