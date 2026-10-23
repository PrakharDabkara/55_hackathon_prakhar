import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const lib = join(import.meta.dirname, 'allowed-host.sh');

/** Sources the shared allowlist and checks one URL; the exit code is the answer. */
function check(url: string) {
  const r = spawnSync('bash', ['-c', `. "${lib}"; require_allowed_base_url "$1"`, 'x', url], {
    encoding: 'utf8',
  });
  return { status: r.status, stderr: r.stderr };
}

describe('scripts/lib/allowed-host.sh', () => {
  it.each([
    'https://kahanmilega-api.onrender.com',
    'https://kahanmilega-api.onrender.com/',
    'https://kahanmilega-api.onrender.com:443',
    'http://localhost',
    'http://localhost:3000',
    'https://localhost:3000',
    'http://localhost/app',
    'http://127.0.0.1',
    'http://127.0.0.1:53100',
    'https://127.0.0.1:8443/x',
  ])('allows %s', (url) => {
    expect(check(url).status).toBe(0);
  });

  it.each([
    'https://localhost.evil.com',
    'https://evil.com',
    'http://kahanmilega-api.onrender.com',
    'https://kahanmilega-api.onrender.com.evil.com',
    'https://kahanmilega-api.onrender.com:8443',
    'https://evil.com/kahanmilega-api.onrender.com',
    'https://kahanmilega-api.onrender.com@evil.com',
    'https://evil.com@kahanmilega-api.onrender.com',
    'http://localhost.evil.com',
    'http://127.0.0.1.evil.com',
    'http://localhost@evil.com',
    'http://localhost:abc',
    'http://localhost:80@evil.com',
    'https://kahanmilega-api.onrender.com?x=1',
    'https://kahanmilega-api.onrender.com#x',
    'https://kahanmilega-api.onrender.com\\@evil.com',
    'https://KAHANMILEGA-API.onrender.com.evil.com',
    'ftp://localhost',
    'localhost:3000',
    '',
  ])('refuses %j and names the allowed hosts', (url) => {
    const r = check(url);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('kahanmilega-api.onrender.com');
    expect(r.stderr).toContain('localhost');
    expect(r.stderr).toContain('127.0.0.1');
  });
});
