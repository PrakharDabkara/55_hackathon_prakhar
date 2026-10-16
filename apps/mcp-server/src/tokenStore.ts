import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface StoredLogin {
  token: string;
  apiUrl: string;
}

/** Reads the saved login, or null if there is none or the file is damaged. */
export function loadToken(file: string): StoredLogin | null {
  try {
    const data = JSON.parse(readFileSync(file, 'utf8')) as Partial<StoredLogin>;
    return typeof data.token === 'string' && typeof data.apiUrl === 'string'
      ? { token: data.token, apiUrl: data.apiUrl }
      : null;
  } catch {
    return null;
  }
}

/** Saves the login for this user only (mode 0600). The file is git-ignored. */
export function saveToken(file: string, login: StoredLogin): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(login), { mode: 0o600 });
  chmodSync(file, 0o600);
}
