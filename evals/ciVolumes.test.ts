import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The e2e job on the self-hosted runner (the author's laptop) must never meet the local dev data.
// The compose volumes have fixed names so local data survives the rename (docs/naming.md); a
// different COMPOSE_PROJECT_NAME alone does not separate them, so CI names its own volumes.
const root = fileURLToPath(new URL('..', import.meta.url));
const compose = readFileSync(`${root}/docker-compose.yml`, 'utf8');
const ci = readFileSync(`${root}/.github/workflows/ci.yml`, 'utf8');
const e2eJob = ci.slice(ci.indexOf('\n  e2e:'), ci.indexOf('\n  deploy:'));

describe('the CI database and Redis volumes', () => {
  it('can be renamed from the environment, and default to the local ones', () => {
    expect(compose).toMatch(/name: \$\{PGDATA_VOLUME:-kahanmilega_pgdata\}/);
    expect(compose).toMatch(/name: \$\{REDISDATA_VOLUME:-kahanmilega_redisdata\}/);
  });

  it('are named for CI in the e2e job, so it never touches local data', () => {
    expect(e2eJob).toMatch(/PGDATA_VOLUME: askbuy-ci_pgdata/);
    expect(e2eJob).toMatch(/REDISDATA_VOLUME: askbuy-ci_redisdata/);
  });

  it('are emptied before the job starts, in case an earlier job died before cleaning up', () => {
    const down = e2eJob.indexOf('- run: docker compose down -v');
    expect(down).toBeGreaterThan(-1);
    expect(down).toBeLessThan(e2eJob.indexOf('- run: npm run db:up'));
  });
});
