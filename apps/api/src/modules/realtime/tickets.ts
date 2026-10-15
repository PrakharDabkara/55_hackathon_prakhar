import { createHash, randomBytes } from 'node:crypto';
import type { Role } from '@kahanmilega/shared';

/** A ticket opens one stream within this time. Short, because it travels in a URL. */
export const TICKET_TTL_SECONDS = 60;

/** The two Redis commands tickets need. */
export interface TicketStore {
  set(key: string, value: string, mode: 'EX', seconds: number): Promise<unknown>;
  getdel(key: string): Promise<string | null>;
}

export interface TicketHolder {
  userId: string;
  role: Role;
}

// Only the hash is stored: a copy of Redis never yields a usable ticket.
const keyOf = (ticket: string) => `ticket:${createHash('sha256').update(ticket).digest('hex')}`;

/**
 * A random one-time ticket for the event stream. EventSource cannot send an Authorization header,
 * and a bearer token in a URL would end up in logs and history, so the URL carries this instead.
 */
export async function issueTicket(
  store: TicketStore,
  user: { id: string; role: Role },
  ttlSeconds = TICKET_TTL_SECONDS,
): Promise<string> {
  const ticket = randomBytes(32).toString('base64url');
  const holder: TicketHolder = { userId: user.id, role: user.role };
  await store.set(keyOf(ticket), JSON.stringify(holder), 'EX', ttlSeconds);
  return ticket;
}

/** Who the ticket was issued to, or null. GETDEL reads and deletes in one step: single use. */
export async function consumeTicket(
  store: TicketStore,
  ticket: string,
): Promise<TicketHolder | null> {
  if (!ticket) return null;
  const raw = await store.getdel(keyOf(ticket));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<TicketHolder>;
    return typeof parsed.userId === 'string' && typeof parsed.role === 'string'
      ? { userId: parsed.userId, role: parsed.role }
      : null;
  } catch {
    return null;
  }
}
