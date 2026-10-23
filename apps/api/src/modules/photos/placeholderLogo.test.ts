import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { initialsOf, placeholderLogo } from './placeholderLogo.js';
import { processLogo } from './logo.js';

describe('placeholder logos', () => {
  it('takes up to two initials from a shop name', () => {
    expect(initialsOf('Sharma Kirana & General Store')).toBe('SK');
    expect(initialsOf('Jain Electricals')).toBe('JE');
    expect(initialsOf('shree')).toBe('S');
    expect(initialsOf('  ')).toBe('?');
  });

  it('draws a PNG the logo pipeline accepts, the same for the same name', async () => {
    const png = await placeholderLogo('Jain Electricals');
    expect((await sharp(png).metadata()).format).toBe('png');
    const processed = await processLogo(png);
    expect(processed.mime).toBe('image/webp');
    expect(processed.size).toBeLessThan(400 * 1024);
    expect((await placeholderLogo('Jain Electricals')).equals(png)).toBe(true);
  });

  it('never puts the name into markup: a name full of tags still draws', async () => {
    const png = await placeholderLogo('<script>alert(1)</script> & "Co"');
    expect((await sharp(png).metadata()).format).toBe('png');
  });
});
