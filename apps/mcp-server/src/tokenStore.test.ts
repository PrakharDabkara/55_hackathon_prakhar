import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loginWithDemoOtp } from './login.js';
import { loadToken, saveToken } from './tokenStore.js';

const dir = () => mkdtempSync(path.join(tmpdir(), 'km-mcp-'));

describe('the local token file', () => {
  it('is missing at first, and is written readable by the owner only', () => {
    const file = path.join(dir(), 'token.json');
    expect(loadToken(file)).toBeNull();
    saveToken(file, { token: 't0k', apiUrl: 'https://api.example' });
    expect(loadToken(file)).toEqual({ token: 't0k', apiUrl: 'https://api.example' });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readFileSync(file, 'utf8')).toContain('t0k');
  });

  it('treats a damaged or missing file as logged out', () => {
    const file = path.join(dir(), 'token.json');
    writeFileSync(file, '{ not json');
    expect(loadToken(file)).toBeNull();
    writeFileSync(file, JSON.stringify({ nothing: true }));
    expect(loadToken(file)).toBeNull();
    expect(loadToken(path.join(dir(), 'nope.json'))).toBeNull();
  });
});

describe('loginWithDemoOtp', () => {
  const reply = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  it('runs the demo OTP flow as a seeker and returns the token', async () => {
    const calls: string[] = [];
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      calls.push(`${init?.method ?? 'GET'} ${new URL(u).pathname}`);
      if (u.includes('/auth/otp/request')) return reply(200, {});
      if (u.includes('/dev/otp-inbox')) return reply(200, { code: '123456' });
      expect(JSON.parse(String(init?.body))).toEqual({
        phone: '9876543210',
        code: '123456',
        role: 'seeker',
      });
      return reply(200, { token: 'secret-token', user: { role: 'seeker' } });
    };
    const token = await loginWithDemoOtp({
      apiUrl: 'https://api.example',
      phone: '9876543210',
      fetch: fetchImpl,
    });
    expect(token).toBe('secret-token');
    expect(calls).toEqual([
      'POST /auth/otp/request',
      'GET /dev/otp-inbox',
      'POST /auth/otp/verify',
    ]);
  });

  it('explains a failure without printing a token', async () => {
    await expect(
      loginWithDemoOtp({
        apiUrl: 'https://api.example',
        phone: '9876543210',
        fetch: async () => reply(429, { error: { code: 'too_many_otp_requests' } }),
      }),
    ).rejects.toThrow(/too many|rate|try again/i);
  });
});
