import { ApiError } from '../../http/errors.js';

/** The windows "Aaj ki maang" can look back over, in days (ADR-0040). */
export const WINDOWS = [1, 7] as const;
export type WindowDays = (typeof WINDOWS)[number];

/** `?days=`: 1 or 7, 1 when left out; anything else is a 400. */
export function parseDays(value: unknown): WindowDays {
  if (value === undefined) return 1;
  const days = WINDOWS.find((d) => String(d) === value);
  if (!days) throw new ApiError(400, 'invalid_request', 'days must be 1 or 7');
  return days;
}
