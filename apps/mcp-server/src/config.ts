import { existsSync, renameSync } from 'node:fs';
import path from 'node:path';

/** The live site. Override with ASKBUY_API_URL (for example http://localhost:3000). */
export const DEFAULT_API_URL = 'https://kahanmilega-api.onrender.com';

/** Where `npm run mcp:login` saves the session: git-ignored, next to this package. */
export const defaultTokenFile = (packageDir: string): string =>
  path.join(packageDir, '.askbuy-login.json');

/** The login file before the rename. Moved to the new name on first run. */
const legacyTokenFile = (packageDir: string): string =>
  path.join(packageDir, '.kahanmilega-login.json');

function migrateLegacyLogin(packageDir: string): void {
  const from = legacyTokenFile(packageDir);
  const to = defaultTokenFile(packageDir);
  if (existsSync(from) && !existsSync(to)) renameSync(from, to);
}

export function resolveConfig(env: NodeJS.ProcessEnv, packageDir: string) {
  migrateLegacyLogin(packageDir);
  // The KAHANMILEGA_* names are the old ones; they still work so existing setups keep running.
  const apiUrl = env['ASKBUY_API_URL'] ?? env['KAHANMILEGA_API_URL'] ?? DEFAULT_API_URL;
  return {
    apiUrl: apiUrl.replace(/\/+$/, ''),
    tokenFile:
      env['ASKBUY_TOKEN_FILE'] ?? env['KAHANMILEGA_TOKEN_FILE'] ?? defaultTokenFile(packageDir),
  };
}
