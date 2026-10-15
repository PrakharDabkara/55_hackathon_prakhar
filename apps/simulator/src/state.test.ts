import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadState, matches, saveState, type SimState } from './state.ts';

const dir = () => mkdtempSync(path.join(tmpdir(), 'sim-state-'));
const state: SimState = {
  version: 1,
  target: 'http://localhost:3000',
  seed: 1,
  centre: { lat: 22.7196, lng: 75.8577 },
  radiusM: 3000,
  shops: [{ shopId: 's1', token: 't1' }],
};

describe('state file', () => {
  it('saves and loads what it saved', () => {
    const file = path.join(dir(), 'state.json');
    saveState(file, state);
    expect(loadState(file)).toEqual(state);
  });

  it('keeps the tokens private to the owner (mode 600)', () => {
    const file = path.join(dir(), 'state.json');
    saveState(file, state);
    expect(statMode(file)).toBe(0o600);
  });

  it('treats a missing, empty or corrupt file as no state, never as a crash', () => {
    const d = dir();
    expect(loadState(path.join(d, 'nope.json'))).toBeNull();
    const empty = path.join(d, 'empty.json');
    writeFileSync(empty, '');
    expect(loadState(empty)).toBeNull();
    const junk = path.join(d, 'junk.json');
    writeFileSync(junk, '{"version":1,"shops":"x"}');
    expect(loadState(junk)).toBeNull();
    writeFileSync(junk, 'not json');
    expect(loadState(junk)).toBeNull();
  });

  it('is reused only for the same server, seed, area and enough shops', () => {
    const want = { target: state.target, seed: 1, centre: state.centre, radiusM: 3000, count: 1 };
    expect(matches(state, want)).toBe(true);
    expect(matches(state, { ...want, count: 2 })).toBe(false);
    expect(matches(state, { ...want, target: 'https://other.example' })).toBe(false);
    expect(matches(state, { ...want, seed: 2 })).toBe(false);
    expect(matches(state, { ...want, radiusM: 100 })).toBe(false);
    expect(matches(state, { ...want, centre: { lat: 1, lng: 1 } })).toBe(false);
    expect(matches(null, want)).toBe(false);
  });

  it('writes valid JSON a person can read', () => {
    const file = path.join(dir(), 'state.json');
    saveState(file, state);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(state);
  });
});

import { statSync } from 'node:fs';
function statMode(file: string) {
  return statSync(file).mode & 0o777;
}
