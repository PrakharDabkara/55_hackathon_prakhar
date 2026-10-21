export const LIST_STATES = ['DRAFT', 'OPEN', 'FULL', 'ORDERED', 'STOPPED', 'EXPIRED'] as const;
export type ListState = (typeof LIST_STATES)[number];

/** A list still asking or showing binding answers: OPEN (listening) or FULL (enough answers). */
export const isLive = (state: ListState): boolean => state === 'OPEN' || state === 'FULL';
