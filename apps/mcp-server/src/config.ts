import path from 'node:path';

/** The live site. Override with KAHANMILEGA_API_URL (for example http://localhost:3000). */
export const DEFAULT_API_URL = 'https://kahanmilega-api.onrender.com';

/** Where `npm run mcp:login` saves the session: git-ignored, next to this package. */
export const defaultTokenFile = (packageDir: string): string =>
  path.join(packageDir, '.kahanmilega-login.json');

export function resolveConfig(env: NodeJS.ProcessEnv, packageDir: string) {
  return {
    apiUrl: (env['KAHANMILEGA_API_URL'] ?? DEFAULT_API_URL).replace(/\/+$/, ''),
    tokenFile: env['KAHANMILEGA_TOKEN_FILE'] ?? defaultTokenFile(packageDir),
  };
}
