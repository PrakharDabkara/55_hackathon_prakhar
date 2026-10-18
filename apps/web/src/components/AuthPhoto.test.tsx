// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { fakePhotos } from '../test/fakes.js';
import { renderApp } from '../test/render.js';
import { AuthPhoto } from './AuthPhoto.js';

describe('AuthPhoto: a photo fetched with the login, small first, big on tap', () => {
  it('loads the picture by id and shows it as a thumbnail button', async () => {
    const api = fakePhotos();
    renderApp(<AuthPhoto api={api} id="p1" alt="Customer ki photo" />);
    expect(
      await screen.findByRole('button', { name: 'Customer ki photo: bada karein' }),
    ).toBeTruthy();
    expect(api.photoSrc).toHaveBeenCalledWith('p1');
    const img = screen.getByRole('img', { name: 'Customer ki photo' }) as HTMLImageElement;
    expect(img.src.startsWith('data:image/jpeg')).toBe(true);
  });

  it('tapping it opens the big picture; Band karein or Escape closes it', async () => {
    const { user } = renderApp(<AuthPhoto api={fakePhotos()} id="p1" alt="Dukaan ki photo" />);
    await user.click(await screen.findByRole('button', { name: 'Dukaan ki photo: bada karein' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog.querySelector('img')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Band karein' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Dukaan ki photo: bada karein' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows nothing, and no error, when the photo cannot be loaded', async () => {
    const api = fakePhotos();
    api.photoSrc = vi.fn().mockRejectedValue(new Error('404'));
    renderApp(<AuthPhoto api={api} id="p1" alt="x" />);
    await waitFor(() => expect(api.photoSrc).toHaveBeenCalled());
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
