// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/api.js';
import { fakeSeekerApi, seekerRequest } from '../test/fakes.js';
import { renderApp } from '../test/render.js';
import { Search } from './Search.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function geolocation(impl: (ok: (p: unknown) => void, fail: (e: unknown) => void) => void) {
  vi.stubGlobal('navigator', { ...navigator, geolocation: { getCurrentPosition: impl } });
}

describe('Search', () => {
  it('has one big box asking "क्या चाहिए?" with a hint of what to type', () => {
    renderApp(<Search api={fakeSeekerApi()} onFound={vi.fn()} />);
    const box = screen.getByLabelText('क्या चाहिए?') as HTMLInputElement;
    expect(box.placeholder).toBe('aata, chini, bottle brush…');
  });

  it('has a clearly labelled Demo location (Indore) button that sets 22.7196, 75.8577', async () => {
    const api = fakeSeekerApi();
    const onFound = vi.fn();
    const { user } = renderApp(<Search api={api} onFound={onFound} />);
    await user.type(screen.getByLabelText('क्या चाहिए?'), 'chini');
    expect((screen.getByRole('button', { name: 'Dhoondho' }) as HTMLButtonElement).disabled).toBe(
      true,
    ); // no location yet

    await user.click(screen.getByRole('button', { name: 'Demo location (Indore)' }));
    await user.click(screen.getByRole('button', { name: 'Dhoondho' }));

    await waitFor(() =>
      expect(api.createRequest).toHaveBeenCalledExactlyOnceWith({
        q: 'chini',
        lat: 22.7196,
        lng: 75.8577,
      }),
    );
    expect(onFound).toHaveBeenCalledWith(seekerRequest(), { lat: 22.7196, lng: 75.8577 });
  });

  it('turns "Maine ₹60 mein dekha hai" into targetPricePaise 6000', async () => {
    const api = fakeSeekerApi();
    const { user } = renderApp(<Search api={api} onFound={vi.fn()} />);
    await user.type(screen.getByLabelText('क्या चाहिए?'), 'chini');
    await user.type(screen.getByLabelText(/Maine ₹__ mein dekha hai/), '60');
    await user.click(screen.getByRole('button', { name: 'Demo location (Indore)' }));
    await user.click(screen.getByRole('button', { name: 'Dhoondho' }));
    await waitFor(() =>
      expect(api.createRequest).toHaveBeenCalledWith({
        q: 'chini',
        lat: 22.7196,
        lng: 75.8577,
        targetPricePaise: 6000,
      }),
    );
  });

  it('does not send a price it cannot read, and says why', async () => {
    const api = fakeSeekerApi();
    const { user } = renderApp(<Search api={api} onFound={vi.fn()} />);
    await user.type(screen.getByLabelText('क्या चाहिए?'), 'chini');
    await user.type(screen.getByLabelText(/Maine ₹__ mein dekha hai/), '4.555');
    await user.click(screen.getByRole('button', { name: 'Demo location (Indore)' }));
    await user.click(screen.getByRole('button', { name: 'Dhoondho' }));
    expect(api.createRequest).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/Daam/);
  });

  it('uses the phone location when it is allowed', async () => {
    geolocation((ok) => ok({ coords: { latitude: 12.97, longitude: 77.59 } }));
    const api = fakeSeekerApi();
    const { user } = renderApp(<Search api={api} onFound={vi.fn()} />);
    await user.type(screen.getByLabelText('क्या चाहिए?'), 'aata');
    await user.click(screen.getByRole('button', { name: 'Meri location use karein' }));
    expect(await screen.findByText('Location mil gayi ✓')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Dhoondho' }));
    await waitFor(() =>
      expect(api.createRequest).toHaveBeenCalledWith({ q: 'aata', lat: 12.97, lng: 77.59 }),
    );
  });

  it('falls back to typing the location by hand when the phone refuses', async () => {
    geolocation((_ok, fail) => fail({ code: 1 }));
    const api = fakeSeekerApi();
    const { user } = renderApp(<Search api={api} onFound={vi.fn()} />);
    await user.type(screen.getByLabelText('क्या चाहिए?'), 'aata');
    await user.click(screen.getByRole('button', { name: 'Meri location use karein' }));
    expect(await screen.findByText(/Location nahi mili/)).toBeTruthy();

    await user.type(screen.getByLabelText('Latitude'), '28.61');
    await user.type(screen.getByLabelText('Longitude'), '77.2');
    await user.click(screen.getByRole('button', { name: 'Dhoondho' }));
    await waitFor(() =>
      expect(api.createRequest).toHaveBeenCalledWith({ q: 'aata', lat: 28.61, lng: 77.2 }),
    );
  });

  it('answers an unresolved item with a friendly message and keeps what was typed', async () => {
    const api = fakeSeekerApi({
      createRequest: vi.fn().mockRejectedValue(new ApiError(422, 'item_unresolved', 'no')),
    });
    const { user } = renderApp(<Search api={api} onFound={vi.fn()} />);
    await user.type(screen.getByLabelText('क्या चाहिए?'), 'xyzzy');
    await user.click(screen.getByRole('button', { name: 'Demo location (Indore)' }));
    await user.click(screen.getByRole('button', { name: 'Dhoondho' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      "Samajh nahi aaya — thoda aur detail mein likhiye (jaise 'paper clip', 'nail cutter')",
    );
    expect((screen.getByLabelText('क्या चाहिए?') as HTMLInputElement).value).toBe('xyzzy');
  });

  it('tells a shop account to use another number (403)', async () => {
    const api = fakeSeekerApi({
      createRequest: vi.fn().mockRejectedValue(new ApiError(403, 'forbidden', 'no')),
    });
    const { user } = renderApp(<Search api={api} onFound={vi.fn()} />);
    await user.type(screen.getByLabelText('क्या चाहिए?'), 'aata');
    await user.click(screen.getByRole('button', { name: 'Demo location (Indore)' }));
    await user.click(screen.getByRole('button', { name: 'Dhoondho' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/dukaan ka number/);
  });

  it('keeps the search button off until there is text and a location, and while sending', async () => {
    renderApp(<Search api={fakeSeekerApi()} onFound={vi.fn()} />);
    const button = screen.getByRole('button', { name: 'Dhoondho' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  describe('when the item could be several things', () => {
    const ambiguous = new ApiError(422, 'item_ambiguous', 'Which one?', {
      question: 'Kaunsa clip chahiye?',
      options: [
        { itemId: 'item-paper', nameEn: 'paper clips', nameHi: 'पेपर क्लिप' },
        { itemId: 'item-clothes', nameEn: 'clothes clips', nameHi: 'कपड़े की क्लिप' },
      ],
    });

    async function ask(
      api = fakeSeekerApi({ createRequest: vi.fn().mockRejectedValueOnce(ambiguous) }),
    ) {
      const onFound = vi.fn();
      const view = renderApp(<Search api={api} onFound={onFound} />);
      await view.user.type(screen.getByLabelText('क्या चाहिए?'), 'clip');
      await view.user.type(screen.getByLabelText(/Maine ₹__ mein dekha hai/), '20');
      await view.user.click(screen.getByRole('button', { name: 'Demo location (Indore)' }));
      await view.user.click(screen.getByRole('button', { name: 'Dhoondho' }));
      return { ...view, api, onFound };
    }

    it('asks the question and offers each option as a big button, Hindi name first', async () => {
      await ask();
      expect(await screen.findByText('Kaunsa clip chahiye?')).toBeTruthy();
      const paper = screen.getByRole('button', { name: /पेपर क्लिप/ });
      expect(paper.textContent).toContain('paper clips');
      expect(paper.querySelector('.label-main')?.textContent).toBe('पेपर क्लिप');
      expect(paper.querySelector('.label-sub')?.textContent).toBe('paper clips');
      expect(screen.getByRole('button', { name: /कपड़े की क्लिप/ })).toBeTruthy();
      expect(screen.queryByRole('alert')).toBeNull(); // a question, not an error
    });

    it('tapping an option searches again with its itemId, the same text, price and place', async () => {
      const api = fakeSeekerApi({
        createRequest: vi
          .fn()
          .mockRejectedValueOnce(ambiguous)
          .mockResolvedValueOnce(seekerRequest()),
      });
      const { user, onFound } = await ask(api);
      await user.click(await screen.findByRole('button', { name: /कपड़े की क्लिप/ }));
      await waitFor(() => expect(api.createRequest).toHaveBeenCalledTimes(2));
      expect(api.createRequest).toHaveBeenLastCalledWith({
        q: 'clip',
        lat: 22.7196,
        lng: 75.8577,
        targetPricePaise: 2000,
        itemId: 'item-clothes',
      });
      expect(onFound).toHaveBeenCalledWith(seekerRequest(), { lat: 22.7196, lng: 75.8577 });
    });

    it('clears the question once the customer starts typing something else', async () => {
      const { user } = await ask();
      await screen.findByText('Kaunsa clip chahiye?');
      await user.type(screen.getByLabelText('क्या चाहिए?'), 's');
      expect(screen.queryByText('Kaunsa clip chahiye?')).toBeNull();
    });

    it('shows the question text as plain text, never as markup', async () => {
      const hostile = new ApiError(422, 'item_ambiguous', 'x', {
        question: '<img src=x onerror=alert(1)>Which?',
        options: [
          { itemId: 'a', nameEn: 'a', nameHi: 'अ' },
          { itemId: 'b', nameEn: 'b', nameHi: 'ब' },
        ],
      });
      await ask(fakeSeekerApi({ createRequest: vi.fn().mockRejectedValue(hostile) }));
      expect(await screen.findByText(/<img src=x/)).toBeTruthy();
      expect(document.querySelector('img')).toBeNull();
    });

    it('falls back to the generic error if the 422 has no usable options', async () => {
      const broken = new ApiError(422, 'item_ambiguous', 'x', { question: 'Q?', options: [] });
      await ask(fakeSeekerApi({ createRequest: vi.fn().mockRejectedValue(broken) }));
      expect((await screen.findByRole('alert')).textContent).toMatch(/Kuch gadbad/);
    });
  });
});
