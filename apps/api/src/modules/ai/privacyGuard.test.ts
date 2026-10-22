import { describe, expect, it } from 'vitest';
import { InvalidOutputError } from './types.js';
import {
  assertNoPrivateData,
  findPrivateData,
  PrivacyGuardError,
  redactPrivateData,
} from './privacyGuard.js';

describe('findPrivateData', () => {
  it.each([
    ['9876543210', 'phone'],
    ['call me on 98765 43210 please', 'phone'],
    ['+91 98765-43210', 'phone'],
    ['+919876543210', 'phone'],
    ['0731-234-5678 x', 'phone'],
    ['mail asha.k+shop@example.co.in now', 'email'],
    ['I am at 22.7196, 75.8577', 'coordinates'],
    ['22.719612;75.857712', 'coordinates'],
    ['{"lat":22.7,"lng":75.8}', 'address_field'],
    ['{"addressLine1":"Flat 4B"}', 'address_field'],
    ['{"delivery_address":"x"}', 'address_field'],
    ['{"userId":"u1"}', 'address_field'],
    ['{"phone":"x"}', 'address_field'],
    ['address: Vijay Nagar', 'address_field'],
  ])('blocks %j as %s', (text, reason) => {
    expect(findPrivateData(text)).toBe(reason);
  });

  it.each([
    'chini, namak aur chai patti chahiye',
    '2 kilo chawal, 1 litre sarson ka tel aur 500 gram chini',
    '10 eggs 12 bananas 500 g paneer',
    'EAN 8901234567890 sugar',
    'price 12.50 and 13.75',
    '{"shopId":"3f2c1a9e-0000-4000-8000-000000000001","distanceM":412,"pricePaise":4500}',
    '{"legsM":[120,340],"totalM":460}',
    'Eval Sharma Kirana',
    'the address of a shop is never shown',
    'abc@ is not an email',
    '1 2 3 4 5 6 7 8 9 0',
    '2026-10-22T10:00:00.000Z',
    // a UUID whose tail happens to be ten digits is an id, not a phone number
    '{"shopId":"3f2c1a9e-0000-4000-8000-ab1234567890"}',
  ])('lets %j through', (text) => {
    expect(findPrivateData(text)).toBeNull();
  });
});

describe('assertNoPrivateData', () => {
  it('throws a PrivacyGuardError (an InvalidOutputError) that names the reason and never the content', () => {
    let caught: unknown;
    try {
      assertNoPrivateData(['harmless', 'my number is 9876543210']);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(PrivacyGuardError);
    expect(caught).toBeInstanceOf(InvalidOutputError);
    expect((caught as PrivacyGuardError).reason).toBe('phone');
    expect((caught as Error).message).toMatch(/phone/);
    expect(JSON.stringify(caught)).not.toContain('9876543210');
    expect((caught as Error).message).not.toContain('9876543210');
    expect((caught as Error).stack).not.toContain('9876543210');
  });

  it('does nothing for clean text', () => {
    expect(() => assertNoPrivateData(['sugar', 'salt'])).not.toThrow();
  });
});

describe('redactPrivateData', () => {
  it('replaces phones, emails and coordinates, and leaves the rest', () => {
    expect(redactPrivateData('Gupta Store 98765 43210 gupta@x.in at 22.7196, 75.8577')).toBe(
      'Gupta Store [removed] [removed] at [removed]',
    );
    expect(redactPrivateData('Gupta General Store')).toBe('Gupta General Store');
  });
});
