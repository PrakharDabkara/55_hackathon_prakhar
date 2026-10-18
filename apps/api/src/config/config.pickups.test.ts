import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const valid = {
  DATABASE_URL: 'postgres://u:p@localhost:5433/db',
  REDIS_URL: 'redis://localhost:6379',
};

describe('"Le liya?" settings (ADR-0035)', () => {
  it('asks 15 minutes after the tap unless told otherwise', () => {
    expect(loadConfig(valid).pickupAskAfterMinutes).toBe(15);
    expect(loadConfig({ ...valid, PICKUP_ASK_AFTER_MINUTES: '0' }).pickupAskAfterMinutes).toBe(0);
    expect(loadConfig({ ...valid, PICKUP_ASK_AFTER_MINUTES: '30' }).pickupAskAfterMinutes).toBe(30);
  });

  it('refuses a negative or silly wait', () => {
    expect(() => loadConfig({ ...valid, PICKUP_ASK_AFTER_MINUTES: '-1' })).toThrow(
      /PICKUP_ASK_AFTER_MINUTES/,
    );
    expect(() => loadConfig({ ...valid, PICKUP_ASK_AFTER_MINUTES: '600' })).toThrow(
      /PICKUP_ASK_AFTER_MINUTES/,
    );
  });
});
