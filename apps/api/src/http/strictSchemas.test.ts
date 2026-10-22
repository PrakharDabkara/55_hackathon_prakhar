import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const modules = fileURLToPath(new URL('../modules/', import.meta.url));

/** Every file that declares a route: they read the request, so their schemas must be strict. */
function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return routeFiles(full);
    if (!name.endsWith('.ts') || name.endsWith('.test.ts')) return [];
    return /\brouter\.(get|post|put|patch|delete)\(/.test(readFileSync(full, 'utf8')) ? [full] : [];
  });
}

describe('request schemas reject unknown fields (SEC2)', () => {
  const files = routeFiles(modules);

  it('finds the route files', () => {
    expect(files.length).toBeGreaterThan(15);
  });

  it.each(files.map((f) => [path.relative(modules, f), f]))(
    '%s uses z.strictObject, never z.object',
    (_name, file) => {
      const source = readFileSync(file as string, 'utf8');
      // `z.object(` and `z\n .object(` both: whitespace between the dot and the name is legal.
      expect(source).not.toMatch(/\bz\s*\.\s*object\s*\(/);
      expect(source).not.toMatch(/\)\s*\.\s*strict\s*\(\s*\)/);
    },
  );
});
