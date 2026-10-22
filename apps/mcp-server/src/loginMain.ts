import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { resolveConfig } from './config.js';
import { loginWithDemoOtp } from './login.js';
import { saveToken } from './tokenStore.js';

// `npm run mcp:login -- --phone <a number in the server DEMO_PHONES>`. Prints "logged in" and nothing else: never the token.
const { values } = parseArgs({ options: { phone: { type: 'string' } } });
const phone = values.phone?.replace(/[\s-]/g, '');
if (!phone || !/^(?:\+?91|0)?[6-9]\d{9}$/.test(phone)) {
  console.error('Usage: npm run mcp:login -- --phone <10-digit mobile number>');
  process.exit(2);
}

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = resolveConfig(process.env, packageDir);
try {
  const token = await loginWithDemoOtp({ apiUrl: config.apiUrl, phone });
  saveToken(config.tokenFile, { token, apiUrl: config.apiUrl });
  console.log('logged in');
} catch (error) {
  console.error(`Login failed: ${(error as Error).message}`);
  process.exit(1);
}
