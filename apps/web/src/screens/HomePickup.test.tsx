// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { fakeSeekerApi } from '../test/fakes.js';
import { renderApp } from '../test/render.js';
import { Home } from './Home.js';

vi.mock('../components/ResultsMap.js', () => ({ ResultsMap: () => <div /> }));

describe('the home screen asks "Le liya?" (ADR-0035)', () => {
  it('shows the question above the search when one is waiting', async () => {
    const api = fakeSeekerApi({
      pendingPickups: vi.fn(async () => [
        { id: 'p1', item: { nameEn: 'sugar', nameHi: 'चीनी' }, shop: { name: 'Sharma Kirana' } },
      ]),
    });
    renderApp(<Home api={api} onFound={vi.fn()} navigate={vi.fn()} />);
    expect(await screen.findByText('Kya aapko sugar Sharma Kirana par mila?')).toBeTruthy();
    expect(screen.getByLabelText('क्या चाहिए?')).toBeTruthy();
  });

  it('is just the home screen when nothing is waiting', async () => {
    const api = fakeSeekerApi();
    renderApp(<Home api={api} onFound={vi.fn()} navigate={vi.fn()} />);
    expect(await screen.findByRole('link', { name: /Mere orders/ })).toBeTruthy();
    expect(screen.queryByText(/Kya aapko/)).toBeNull();
  });
});
