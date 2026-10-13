import { describe, expect, it } from 'vitest';
import { extrapolate, parseCommandStats } from './commandStats.js';

const info = [
  '# Commandstats',
  'cmdstat_get:calls=10,usec=50,usec_per_call=5.00,rejected_calls=0,failed_calls=0',
  'cmdstat_bzpopmin:calls=300,usec=900,usec_per_call=3.00,rejected_calls=0,failed_calls=0',
  '',
].join('\r\n');

describe('parseCommandStats', () => {
  it('maps command name to call count', () => {
    expect(parseCommandStats(info)).toEqual({ get: 10, bzpopmin: 300 });
  });

  it('ignores lines that are not cmdstat', () => {
    expect(parseCommandStats('# Commandstats\r\nfoo:bar')).toEqual({});
  });
});

describe('extrapolate', () => {
  it('scales a 10 minute sample to a 30 day month and compares with the Upstash cap', () => {
    const r = extrapolate(600, 600); // 1 command/second
    expect(r.perSecond).toBe(1);
    expect(r.perMonth).toBe(2_592_000);
    expect(r.percentOfUpstashFree).toBeCloseTo(518.4, 1);
  });
});
