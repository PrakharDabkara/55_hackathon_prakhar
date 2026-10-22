import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const valid = {
  DATABASE_URL: 'postgres://u:p@localhost:5433/db',
  REDIS_URL: 'redis://localhost:6379',
};
const vapid = {
  VAPID_PUBLIC_KEY: 'BPublicKeyPublicKeyPublicKey',
  VAPID_PRIVATE_KEY: 'private-key-do-not-print',
  VAPID_SUBJECT: 'mailto:ops@example.com',
};

describe('Web Push settings (ADR-0034)', () => {
  it('is off when nothing is set, in every environment', () => {
    expect(loadConfig(valid).vapid).toBeNull();
    expect(
      loadConfig({
        ...valid,
        NODE_ENV: 'production',
        DEMO_PHONES: '9000000001',
        OTP_MODE: 'simulated',
        LLM_PROVIDER: 'gemini',
        GEMINI_API_KEY: 'k',
      }).vapid,
    ).toBeNull();
  });

  it('treats blanks, as .env.example ships them, as unset', () => {
    expect(
      loadConfig({ ...valid, VAPID_PUBLIC_KEY: '', VAPID_PRIVATE_KEY: '', VAPID_SUBJECT: '' })
        .vapid,
    ).toBeNull();
  });

  it('is on when all three are set', () => {
    expect(loadConfig({ ...valid, ...vapid }).vapid).toEqual({
      publicKey: vapid.VAPID_PUBLIC_KEY,
      privateKey: vapid.VAPID_PRIVATE_KEY,
      subject: vapid.VAPID_SUBJECT,
    });
  });

  it('turns push off instead of crashing when only some are set', () => {
    const config = loadConfig({ ...valid, VAPID_PUBLIC_KEY: vapid.VAPID_PUBLIC_KEY });
    expect(config.vapid).toBeNull();
  });

  it('turns push off when the subject is not a mailto: or https: address', () => {
    expect(loadConfig({ ...valid, ...vapid, VAPID_SUBJECT: 'ops@example.com' }).vapid).toBeNull();
    expect(
      loadConfig({ ...valid, ...vapid, VAPID_SUBJECT: 'https://askbuy.example' }).vapid,
    ).not.toBeNull();
  });

  it('limits pushes to 5 per user per minute unless told otherwise', () => {
    expect(loadConfig(valid).pushMaxPerMinute).toBe(5);
    expect(loadConfig({ ...valid, PUSH_MAX_PER_MINUTE: '2' }).pushMaxPerMinute).toBe(2);
    expect(() => loadConfig({ ...valid, PUSH_MAX_PER_MINUTE: '0' })).toThrow(/PUSH_MAX_PER_MINUTE/);
  });
});
