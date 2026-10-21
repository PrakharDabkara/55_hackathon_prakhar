import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveConfig } from './config.js';

const tmp = () => mkdtempSync(path.join(tmpdir(), 'askbuy-config-'));

describe('resolveConfig', () => {
  it('reads ASKBUY_API_URL and ASKBUY_TOKEN_FILE', () => {
    const c = resolveConfig(
      { ASKBUY_API_URL: 'http://localhost:3000/', ASKBUY_TOKEN_FILE: '/x/t.json' },
      tmp(),
    );
    expect(c).toEqual({ apiUrl: 'http://localhost:3000', tokenFile: '/x/t.json' });
  });

  it('still honours the old KAHANMILEGA_* names, and the new ones win', () => {
    expect(resolveConfig({ KAHANMILEGA_API_URL: 'http://old' }, tmp()).apiUrl).toBe('http://old');
    expect(
      resolveConfig({ KAHANMILEGA_API_URL: 'http://old', ASKBUY_API_URL: 'http://new' }, tmp())
        .apiUrl,
    ).toBe('http://new');
  });

  it('saves the login as .askbuy-login.json', () => {
    const dir = tmp();
    expect(resolveConfig({}, dir).tokenFile).toBe(path.join(dir, '.askbuy-login.json'));
  });

  it('moves an old .kahanmilega-login.json to the new name so nobody has to log in again', () => {
    const dir = tmp();
    writeFileSync(path.join(dir, '.kahanmilega-login.json'), '{"token":"t"}');
    const { tokenFile } = resolveConfig({}, dir);
    expect(readFileSync(tokenFile, 'utf8')).toBe('{"token":"t"}');
    expect(existsSync(path.join(dir, '.kahanmilega-login.json'))).toBe(false);
  });
});
