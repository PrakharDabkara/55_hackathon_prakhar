// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/api.js';
import { fakeSeekerApi, seekerRequest } from '../test/fakes.js';
import { renderApp } from '../test/render.js';
import { Search } from './Search.js';

// jsdom cannot decode or draw a picture: the shrink step (canvas) is replaced by a pass-through.
vi.mock('../lib/photo.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/photo.js')>()),
  shrinkPhoto: async (file: Blob) => file,
}));

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

  describe('what the customer is told when a new item cannot be asked', () => {
    async function failWith(error: ApiError) {
      const api = fakeSeekerApi({ createRequest: vi.fn().mockRejectedValue(error) });
      const { user } = renderApp(<Search api={api} onFound={vi.fn()} />);
      await user.type(screen.getByLabelText('क्या चाहिए?'), 'something');
      await user.click(screen.getByRole('button', { name: 'Demo location (Indore)' }));
      await user.click(screen.getByRole('button', { name: 'Dhoondho' }));
    }

    it('a blocked item: "Ye cheez hum dukaanon ko nahi bhej sakte"', async () => {
      await failWith(new ApiError(422, 'item_blocked', 'x'));
      expect(await screen.findByRole('alert')).toHaveProperty(
        'textContent',
        'Ye cheez hum dukaanon ko nahi bhej sakte',
      );
    });

    it('the safety check being down: "Abhi ye cheez dukaanon ko nahi bhej sakte"', async () => {
      await failWith(new ApiError(503, 'item_unavailable', 'x'));
      expect(await screen.findByRole('alert')).toHaveProperty(
        'textContent',
        'Abhi ye cheez dukaanon ko nahi bhej sakte',
      );
    });

    it('over the daily limit: a plain message, not a generic error', async () => {
      await failWith(new ApiError(429, 'new_item_limit', 'x', { scope: 'day' }));
      expect((await screen.findByRole('alert')).textContent).toMatch(/nayi cheez.*limit/i);
    });
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
      'Ye cheez samajh nahi aayi — thoda aur batayein',
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

describe('Search: "Kya aapka matlab…?" before any shop is asked (PR H)', () => {
  const unsure = new ApiError(422, 'item_confirm', 'Do you mean?', {
    item: { itemId: 'item-brush', nameEn: 'bottle brush', nameHi: 'बोतल ब्रश' },
    alternatives: [
      { itemId: 'item-toilet', nameEn: 'toilet brush', nameHi: 'टॉयलेट ब्रश' },
      { itemId: 'item-hair', nameEn: 'hair brush', nameHi: 'हेयर ब्रश' },
    ],
  });

  async function ask(api: ReturnType<typeof fakeSeekerApi>, text = 'bottle brsh') {
    const onFound = vi.fn();
    const view = renderApp(<Search api={api} onFound={onFound} />);
    await view.user.type(screen.getByLabelText('क्या चाहिए?'), text);
    await view.user.click(screen.getByRole('button', { name: 'Demo location (Indore)' }));
    await view.user.click(screen.getByRole('button', { name: 'Dhoondho' }));
    return { ...view, onFound };
  }
  const apiWith = (...more: unknown[]) => {
    const createRequest = vi.fn().mockRejectedValueOnce(unsure);
    for (const m of more) createRequest.mockResolvedValueOnce(m);
    return fakeSeekerApi({ createRequest });
  };

  it('shows what was understood in Hindi and English, with "Haan, yahi", the alternatives and "Kuch aur likhein"', async () => {
    await ask(apiWith());
    expect(await screen.findByText('Kya aapka matlab…?')).toBeTruthy();
    const yes = screen.getByRole('button', { name: /Haan, yahi/ });
    expect(yes.textContent).toContain('बोतल ब्रश');
    expect(yes.textContent).toContain('bottle brush');
    expect(screen.getByRole('button', { name: /टॉयलेट ब्रश/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /हेयर ब्रश/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Kuch aur likhein' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull(); // a question, not an error
  });

  it('"Haan, yahi" asks the shops: same text, price and place, with the understood item', async () => {
    const api = apiWith(seekerRequest());
    const { user, onFound } = await ask(api);
    await user.click(await screen.findByRole('button', { name: /Haan, yahi/ }));
    await waitFor(() => expect(api.createRequest).toHaveBeenCalledTimes(2));
    expect(api.createRequest).toHaveBeenLastCalledWith({
      q: 'bottle brsh',
      lat: 22.7196,
      lng: 75.8577,
      itemId: 'item-brush',
      understanding: 'confirmed',
    });
    expect(onFound).toHaveBeenCalled();
  });

  it('an alternative is searched with its own id and counted as a change', async () => {
    const api = apiWith(seekerRequest());
    const { user } = await ask(api);
    await user.click(await screen.findByRole('button', { name: /टॉयलेट ब्रश/ }));
    await waitFor(() => expect(api.createRequest).toHaveBeenCalledTimes(2));
    expect(api.createRequest).toHaveBeenLastCalledWith(
      expect.objectContaining({ itemId: 'item-toilet', understanding: 'changed' }),
    );
  });

  it('"Kuch aur likhein" asks nothing, empties the box and focuses it; the next search is counted as a change', async () => {
    const api = apiWith(seekerRequest());
    const { user } = await ask(api);
    await user.click(await screen.findByRole('button', { name: 'Kuch aur likhein' }));
    const box = screen.getByLabelText('क्या चाहिए?') as HTMLInputElement;
    expect(box.value).toBe('');
    expect(document.activeElement).toBe(box);
    expect(screen.queryByText('Kya aapka matlab…?')).toBeNull();
    expect(api.createRequest).toHaveBeenCalledTimes(1);
    await user.type(box, 'bottle cleaner');
    await user.click(screen.getByRole('button', { name: 'Dhoondho' }));
    await waitFor(() => expect(api.createRequest).toHaveBeenCalledTimes(2));
    expect(api.createRequest).toHaveBeenLastCalledWith({
      q: 'bottle cleaner',
      lat: 22.7196,
      lng: 75.8577,
      understanding: 'changed',
    });
  });

  it('a word with several meanings gets "Kuch aur likhein" too', async () => {
    const ambiguous = new ApiError(422, 'item_ambiguous', 'x', {
      question: 'Kaunsi mirch chahiye?',
      options: [
        { itemId: 'a', nameEn: 'green chilli', nameHi: 'हरी मिर्च' },
        { itemId: 'b', nameEn: 'black pepper', nameHi: 'काली मिर्च' },
      ],
    });
    await ask(fakeSeekerApi({ createRequest: vi.fn().mockRejectedValue(ambiguous) }), 'mirchi');
    expect(await screen.findByText('Kaunsi mirch chahiye?')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Kuch aur likhein' })).toBeTruthy();
  });

  it('clears the question when the customer types again, and shows names as plain text', async () => {
    const hostile = new ApiError(422, 'item_confirm', 'x', {
      item: { itemId: 'a', nameEn: '<img src=x onerror=alert(1)>', nameHi: 'अ' },
      alternatives: [],
    });
    const { user } = await ask(
      fakeSeekerApi({ createRequest: vi.fn().mockRejectedValue(hostile) }),
    );
    expect(await screen.findByText(/<img src=x/)).toBeTruthy();
    expect(document.querySelector('img')).toBeNull();
    await user.type(screen.getByLabelText('क्या चाहिए?'), 's');
    expect(screen.queryByText('Kya aapka matlab…?')).toBeNull();
  });

  it('falls back to the generic error when the 422 has no usable item', async () => {
    const broken = new ApiError(422, 'item_confirm', 'x', { alternatives: [] });
    await ask(fakeSeekerApi({ createRequest: vi.fn().mockRejectedValue(broken) }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Kuch gadbad/);
  });
});

describe('Search with a photo (optional)', () => {
  const searchWithPhoto = async (api: ReturnType<typeof fakeSeekerApi>, attach: boolean) => {
    const { user, container } = renderApp(<Search api={api} onFound={vi.fn()} />);
    await user.type(screen.getByLabelText('क्या चाहिए?'), 'bottle brush');
    await user.click(screen.getByRole('button', { name: 'Demo location (Indore)' }));
    if (attach) {
      const input = container.querySelector('input[type="file"]') as HTMLInputElement;
      await user.upload(input, new File([new Uint8Array(300)], 'a.jpg', { type: 'image/jpeg' }));
      await screen.findByRole('button', { name: 'Photo hatayein' });
    }
    await user.click(screen.getByRole('button', { name: 'Dhoondho' }));
  };

  it('offers "Photo jodein" and sends the photo id with the request', async () => {
    const api = fakeSeekerApi();
    await searchWithPhoto(api, true);
    await waitFor(() =>
      expect(api.createRequest).toHaveBeenCalledWith(
        expect.objectContaining({ q: 'bottle brush', photoId: 'photo-1' }),
      ),
    );
    expect(api.uploadPhoto).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ role: 'request' }),
    );
  });

  it('is never required: without a photo the request has no photoId', async () => {
    const api = fakeSeekerApi();
    await searchWithPhoto(api, false);
    await waitFor(() => expect(api.createRequest).toHaveBeenCalled());
    expect(api.createRequest).toHaveBeenCalledWith(
      expect.not.objectContaining({ photoId: expect.anything() }),
    );
  });

  it('a failed upload does not block the search', async () => {
    const api = fakeSeekerApi({ uploadPhoto: vi.fn().mockRejectedValue(new Error('x')) });
    const { user, container } = renderApp(<Search api={api} onFound={vi.fn()} />);
    await user.type(screen.getByLabelText('क्या चाहिए?'), 'chini');
    await user.click(screen.getByRole('button', { name: 'Demo location (Indore)' }));
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File([new Uint8Array(300)], 'a.jpg', { type: 'image/jpeg' }));
    await screen.findByRole('alert');
    expect((screen.getByRole('button', { name: 'Dhoondho' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });
});

describe('Search: "Deliver to me" (Delivery v2)', () => {
  const searchFor = async (user: ReturnType<typeof renderApp>['user']) => {
    await user.type(screen.getByLabelText('क्या चाहिए?'), 'chini');
    await user.click(screen.getByRole('button', { name: 'Demo location (Indore)' }));
  };

  it('is unticked by default and sends no delivery fields', async () => {
    const api = fakeSeekerApi();
    const { user } = renderApp(<Search api={api} onFound={vi.fn()} />);
    expect((screen.getByLabelText('Ghar mangwao') as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByLabelText('Ghar ka pata')).toBeNull();
    await searchFor(user);
    await user.click(screen.getByRole('button', { name: 'Dhoondho' }));
    const sent = vi.mocked(api.createRequest).mock.calls[0]?.[0] as unknown as Record<
      string,
      unknown
    >;
    expect(sent).not.toHaveProperty('wantsDelivery');
    expect(sent).not.toHaveProperty('deliveryAddressId');
  });

  it('ticked, it uses the saved address and sends wantsDelivery with its id', async () => {
    const api = fakeSeekerApi({
      savedAddress: vi.fn(async () => ({
        id: 'addr-1',
        addressText: 'Flat 4B, Vijay Nagar',
        customerName: null,
      })),
    });
    const { user } = renderApp(<Search api={api} onFound={vi.fn()} />);
    await user.click(screen.getByLabelText('Ghar mangwao'));
    expect(await screen.findByText(/Flat 4B, Vijay Nagar/)).toBeTruthy();
    await searchFor(user);
    await user.click(screen.getByRole('button', { name: 'Dhoondho' }));
    expect(api.createRequest).toHaveBeenCalledWith(
      expect.objectContaining({ wantsDelivery: true, deliveryAddressId: 'addr-1' }),
    );
  });

  it('ticked with no saved address it asks for one, keeps it, then searches', async () => {
    const api = fakeSeekerApi({
      keepAddress: vi.fn(async () => ({
        id: 'addr-9',
        addressText: 'Shop 9, Palasia',
        customerName: null,
      })),
    });
    const { user } = renderApp(<Search api={api} onFound={vi.fn()} />);
    await user.click(screen.getByLabelText('Ghar mangwao'));
    await searchFor(user);
    // Required once ticked: the search does not go without an address.
    expect(screen.getByRole('button', { name: 'Dhoondho' }).hasAttribute('disabled')).toBe(true);
    await user.type(screen.getByLabelText('Ghar ka pata'), 'Shop 9, Palasia');
    await user.click(screen.getByRole('button', { name: 'Dhoondho' }));
    expect(api.keepAddress).toHaveBeenCalledWith({ addressText: 'Shop 9, Palasia' });
    expect(api.createRequest).toHaveBeenCalledWith(
      expect.objectContaining({ wantsDelivery: true, deliveryAddressId: 'addr-9' }),
    );
  });
});
