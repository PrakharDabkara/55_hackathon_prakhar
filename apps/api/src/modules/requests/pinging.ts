import type { RequestRecord } from './persistence.js';

/**
 * Called once, after the commit, when a new request lands in PINGING (learned stock was too thin).
 * Day 7 fans out the shop pings from here. It does nothing yet.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function onRequestPinging(request: RequestRecord): Promise<void> {
  // Intentionally empty until Day 7.
}
