// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/api.js';
import { fakePhotos } from '../test/fakes.js';
import { renderApp } from '../test/render.js';
import { PhotoPicker } from './PhotoPicker.js';

const file = () => new File([new Uint8Array(2000)], 'IMG_0001.jpg', { type: 'image/jpeg' });
const prepared = new Blob([new Uint8Array(500)], { type: 'image/jpeg' });
const prepare = vi.fn(async () => prepared);

const setup = (over: Partial<Parameters<typeof PhotoPicker>[0]> = {}) => {
  const api = fakePhotos();
  const onChange = vi.fn();
  const ui = renderApp(
    <PhotoPicker api={api} role="request" onChange={onChange} prepare={prepare} {...over} />,
  );
  const input = () => ui.container.querySelector('input[type="file"]') as HTMLInputElement;
  return { ...ui, api, onChange, input };
};

describe('PhotoPicker ("Photo jodein"): optional, never in the way', () => {
  it('offers one button, "Photo jodein", and a hidden file input that takes images', () => {
    const { input } = setup();
    expect(screen.getByRole('button', { name: 'Photo jodein' })).toBeTruthy();
    expect(input().accept).toBe('image/*');
    expect(input().hidden || input().className.includes('visually-hidden')).toBe(true);
  });

  it('shrinks the picture, uploads it, shows a preview, and tells the parent the photo id', async () => {
    const { user, api, onChange, input } = setup({ errand: { id: 'e1', label: 'chart paper' } });
    await user.upload(input(), file());
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith('photo-1'));
    expect(prepare).toHaveBeenCalled();
    expect(api.uploadPhoto).toHaveBeenCalledWith(
      prepared,
      expect.objectContaining({ role: 'request', errand: { id: 'e1', label: 'chart paper' } }),
    );
    expect(await screen.findByRole('img', { name: /photo/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Photo hatayein' })).toBeTruthy();
  });

  it('shows the upload progress while it runs', async () => {
    const api = fakePhotos();
    let report: (percent: number) => void = () => undefined;
    let finish: (v: { id: string }) => void = () => undefined;
    api.uploadPhoto = vi.fn(
      (_b, opts) =>
        new Promise((resolve) => {
          report = opts.onProgress ?? (() => undefined);
          finish = resolve;
        }),
    );
    const { user, input } = setup({ api });
    await user.upload(input(), file());
    await waitFor(() => expect(api.uploadPhoto).toHaveBeenCalled());
    report(40);
    expect(await screen.findByText('Upload ho raha hai 40%')).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('40');
    finish({ id: 'photo-9' });
    await waitFor(() => expect(screen.queryByRole('progressbar')).toBeNull());
  });

  it('removing the photo clears it and tells the parent', async () => {
    const { user, onChange, input } = setup();
    await user.upload(input(), file());
    await user.click(await screen.findByRole('button', { name: 'Photo hatayein' }));
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(screen.getByRole('button', { name: 'Photo jodein' })).toBeTruthy();
  });

  it('a failure is a clear message and the picker can be used again', async () => {
    for (const [error, text] of [
      [new ApiError(413, 'photo_too_large', 'x'), /bahut badi/i],
      [new ApiError(429, 'photo_limit', 'x'), /10 photo/i],
      [new ApiError(400, 'invalid_image', 'x'), /JPEG|PNG|WebP|photo nahi/i],
      [new ApiError(0, 'network', 'x'), /internet|network/i],
      [new ApiError(503, 'photo_storage_full', 'x'), /abhi/i],
      [new Error('boom'), /nahi ho payi/i],
    ] as const) {
      const api = fakePhotos();
      api.uploadPhoto = vi.fn().mockRejectedValue(error);
      const { user, onChange, input, unmount } = setup({ api });
      await user.upload(input(), file());
      expect((await screen.findByRole('alert')).textContent).toMatch(text);
      expect(onChange).not.toHaveBeenCalledWith(expect.stringMatching(/./));
      expect(screen.getByRole('button', { name: 'Photo jodein' })).toBeTruthy();
      unmount();
    }
  });

  it('a picture the browser cannot read is a clear message too', async () => {
    const bad = vi.fn().mockRejectedValue(new Error('decode'));
    const { user, input } = setup({ prepare: bad });
    await user.upload(input(), file());
    expect((await screen.findByRole('alert')).textContent).toMatch(/nahi ho payi|photo/i);
  });

  it('names what the photo is for, so a screen reader can tell the checklist rows apart', () => {
    setup({ label: 'chart paper' });
    expect(screen.getByRole('button', { name: 'Photo jodein: chart paper' })).toBeTruthy();
  });
});
