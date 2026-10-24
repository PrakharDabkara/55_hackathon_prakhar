import { describe, expect, it } from 'vitest';
import { redactApiKeys, sanitiseMessage } from './failure.js';

// FAKE keys in the two formats Google issues: AIza + 35 characters, AQ. + 40 to 80.
const classic = `AIzaFakeKeyForTheRedactTest${'x'.repeat(8)}`;
const newer = `AQ.FakeKeyForTheRedactTest${'x'.repeat(30)}`;

describe('redactApiKeys', () => {
  it.each([
    ['AIza', classic],
    ['AQ.', newer],
  ])('hides a %s key wherever it sits in the text', (_format, key) => {
    expect(redactApiKeys(`a ${key} b`)).toBe('a [key] b');
    expect(redactApiKeys(`https://x.test/v1?key=${key}&alt=json`)).toBe(
      'https://x.test/v1?key=[key]&alt=json',
    );
    expect(redactApiKeys(`${key} and ${key}`)).toBe('[key] and [key]');
  });

  it('hides a cut-off key too, and leaves ordinary text and short look-alikes alone', () => {
    expect(redactApiKeys(`key ${newer.slice(0, 20)}`)).toBe('key [key]');
    expect(redactApiKeys('AQ. is a prefix; AIza too; AQ.short')).toBe(
      'AQ. is a prefix; AIza too; AQ.short',
    );
  });

  it('sanitiseMessage hides both formats, then keeps the line short', () => {
    for (const key of [classic, newer]) {
      const message = sanitiseMessage(`bad key ${key}\n${'y'.repeat(500)}`);
      expect(message).not.toContain(key.slice(5));
      expect(message.startsWith('bad key [key] ')).toBe(true);
      expect(message.length).toBeLessThanOrEqual(160);
    }
  });
});
