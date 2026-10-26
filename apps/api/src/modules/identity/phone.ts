import { indianMobile } from '@askbuy/shared';

/** Indian mobile → E.164 (`+91XXXXXXXXXX`), or null. See `indianMobile` for what is accepted. */
export function normalisePhone(raw: string): string | null {
  const digits = indianMobile(raw);
  return digits ? `+91${digits}` : null;
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

/**
 * The person's own whole number, "+91 98765 43210", for the eye button only (ADR-0054, amended by
 * ADR-0068). Never logged: callers put it in a response body and nowhere else.
 */
export function displayFullPhone(phone: string): string {
  const digits = phone.slice(3);
  return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
}
