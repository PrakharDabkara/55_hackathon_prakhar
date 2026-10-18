import { describe, expect, it, vi } from 'vitest';
import { chooseEncoding, fitWithin, MAX_SIDE_PX, TARGET_BYTES } from './photo.js';

describe('fitWithin: at most 1024 px on the longest side, never enlarged', () => {
  it('shrinks a landscape and a portrait photo, keeping the shape', () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 1024, height: 768 });
    expect(fitWithin(3000, 4000)).toEqual({ width: 768, height: 1024 });
    expect(fitWithin(2048, 2048)).toEqual({ width: 1024, height: 1024 });
  });

  it('leaves a small photo alone', () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(1024, 1024)).toEqual({ width: 1024, height: 1024 });
  });

  it('never returns a zero side', () => {
    expect(fitWithin(5000, 2).height).toBeGreaterThanOrEqual(1);
  });

  it('has the numbers the brief names', () => {
    expect(MAX_SIDE_PX).toBe(1024);
    expect(TARGET_BYTES).toBe(100 * 1024);
  });
});

describe('chooseEncoding: about 100 KB, as JPEG', () => {
  const sized = (bytes: number) => new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' });

  it('takes the best quality that fits under the target', async () => {
    const encode = vi.fn(async (quality: number) => sized(Math.round(quality * 200_000)));
    const blob = await chooseEncoding(encode);
    expect(blob.size).toBeLessThanOrEqual(TARGET_BYTES);
    // 0.5 -> 100,000 bytes fits; 0.6 -> 120,000 does not.
    expect(encode).toHaveBeenCalledWith(0.5);
    expect(blob.size).toBe(100_000);
  });

  it('stops at the first quality that fits (no needless work)', async () => {
    const encode = vi.fn(async () => sized(10_000));
    await chooseEncoding(encode);
    expect(encode).toHaveBeenCalledTimes(1);
  });

  it('when nothing fits, sends the smallest it made', async () => {
    const encode = vi.fn(async (quality: number) => sized(Math.round(quality * 1_000_000)));
    const blob = await chooseEncoding(encode);
    const smallest = Math.min(
      ...(await Promise.all(encode.mock.calls.map(([q]) => encode(q as number)))).map(
        (b) => b.size,
      ),
    );
    expect(blob.size).toBe(smallest);
  });

  it('fails clearly when the browser cannot encode', async () => {
    await expect(chooseEncoding(async () => null)).rejects.toThrow(/encode/i);
  });
});
