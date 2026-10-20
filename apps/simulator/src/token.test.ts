import { describe, expect, it, vi } from 'vitest';
import type { Client } from './client.ts';
import { tokenWorks } from './simulator.ts';

const client = (ticket: Client['ticket']) => ({ ticket }) as Client;

describe('tokenWorks (a kept session saves an OTP request)', () => {
  it('is false with no token, without asking the server', async () => {
    const ticket = vi.fn();
    expect(await tokenWorks(client(ticket), undefined)).toBe(false);
    expect(ticket).not.toHaveBeenCalled();
  });

  it('is true when the server accepts the token', async () => {
    expect(
      await tokenWorks(
        client(async () => 't'),
        'kept',
      ),
    ).toBe(true);
  });

  it('is false when the server refuses it, so a fresh login follows', async () => {
    const refused = client(async () => {
      throw new Error('unauthorized');
    });
    expect(await tokenWorks(refused, 'old')).toBe(false);
  });
});
