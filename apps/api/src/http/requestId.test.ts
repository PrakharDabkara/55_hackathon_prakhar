import { describe, expect, it } from 'vitest';
import { pickRequestId } from './requestId.js';

describe('pickRequestId', () => {
  it('reuses a sane incoming id', () => {
    expect(pickRequestId('abc-123_DEF.4')).toBe('abc-123_DEF.4');
  });

  it('generates a short id when missing', () => {
    expect(pickRequestId(undefined)).toMatch(/^[0-9A-F]{6}$/);
  });

  it.each(['has space', 'line\nbreak', 'x'.repeat(129), '', '<script>'])(
    'replaces an unsafe id: %j',
    (bad) => {
      const id = pickRequestId(bad);
      expect(id).not.toBe(bad);
      expect(id).toMatch(/^[0-9A-F]{6}$/);
    },
  );

  it('ignores a repeated header (array form)', () => {
    expect(pickRequestId(['a', 'b'])).toMatch(/^[0-9A-F]{6}$/);
  });
});
