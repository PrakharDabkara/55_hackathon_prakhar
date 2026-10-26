// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import { DEMO_PLACE } from '@askbuy/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api.js';
import { fakeApi, shop } from '../../test/fakes.js';
import { renderApp } from '../../test/render.js';
import { ToastProvider } from '../../ui/Toast.js';
import { Login } from './Login.js';
import { Settings } from './Settings.js';
import { Setup } from './Setup.js';

// jsdom cannot draw a map: this stand-in moves the pin with a button.
vi.mock('../ui/PinMap.js', () => ({
  PinMap: ({
    pin,
    onMove,
  }: {
    pin: { lat: number; lng: number };
    onMove: (p: { lat: number; lng: number }) => void;
  }) => (
    <button data-pin={JSON.stringify(pin)} onClick={() => onMove({ lat: 22.75, lng: 75.9 })}>
      place pin
    </button>
  ),
}));

const here = async () => ({ lat: 22.7, lng: 75.8 });

describe('Login', () => {
  it('shows the brand once, who it is for, a +91 field, a helper and the one primary button', () => {
    renderApp(<Login api={fakeApi()} onLoggedIn={vi.fn()} />, 'en');
    expect(screen.getByRole('heading', { name: 'AskBuy' })).toBeTruthy();
    expect(screen.getByText("Let's lift your shutter online!")).toBeTruthy();
    expect(document.querySelector('.sh-login__brand svg.brand-mark')).toBeTruthy();
    expect(screen.getByLabelText('Mobile number')).toBeTruthy();
    expect(screen.getByText('+91')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send code' }).className).toContain(
      'sh-btn--primary',
    );
  });

  it('asks for the phone, then the code, then logs in as a shop', async () => {
    const api = fakeApi();
    const onLoggedIn = vi.fn();
    const { user } = renderApp(<Login api={api} onLoggedIn={onLoggedIn} />, 'en');
    await user.type(screen.getByLabelText('Mobile number'), '98765 43210');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    expect(api.requestOtp).toHaveBeenCalledWith('9876543210');
    expect(await screen.findByText('Code sent to +91 9876543210')).toBeTruthy();
    await user.type(screen.getByLabelText('6-digit code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    await waitFor(() => expect(onLoggedIn).toHaveBeenCalledWith('token-1'));
    expect(api.verifyOtp).toHaveBeenCalledWith('9876543210', '123456');
  });

  it('does not log in before six digits', async () => {
    const { user } = renderApp(<Login api={fakeApi()} onLoggedIn={vi.fn()} />, 'en');
    await user.type(screen.getByLabelText('Mobile number'), '9876543210');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    await user.type(await screen.findByLabelText('6-digit code'), '123');
    expect((screen.getByRole('button', { name: 'Log in' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('fills the demo code from the inbox', async () => {
    const api = fakeApi({ devInbox: vi.fn(async () => '482913') });
    const { user } = renderApp(<Login api={api} onLoggedIn={vi.fn()} />, 'en');
    await user.type(screen.getByLabelText('Mobile number'), '9876543210');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    expect(await screen.findByText('Demo mode')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Fill the code' }));
    await waitFor(() =>
      expect((screen.getByLabelText('6-digit code') as HTMLInputElement).value).toBe('482913'),
    );
  });

  it('says what to do about a bad number, a wrong code and too many tries', async () => {
    const api = fakeApi({
      requestOtp: vi
        .fn()
        .mockRejectedValueOnce(new ApiError(429, 'rate_limited', 'x'))
        .mockResolvedValue(undefined),
      verifyOtp: vi.fn(async () => Promise.reject(new ApiError(401, 'invalid_code', 'x'))),
    });
    const { user } = renderApp(<Login api={api} onLoggedIn={vi.fn()} />, 'en');
    await user.type(screen.getByLabelText('Mobile number'), '123');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    expect(screen.getByText("That doesn't look like an Indian mobile number.")).toBeTruthy();
    await user.clear(screen.getByLabelText('Mobile number'));
    await user.type(screen.getByLabelText('Mobile number'), '9876543210');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    expect(
      await screen.findByText('Too many tries. Wait a few minutes and try again.'),
    ).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    await user.type(await screen.findByLabelText('6-digit code'), '000000');
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByText('That code is wrong. Check it and try again.')).toBeTruthy();
  });
});

describe('Setup', () => {
  const setup = (api = fakeApi()) => {
    const onDone = vi.fn();
    const view = renderApp(
      <ToastProvider>
        <Setup api={api} onDone={onDone} locate={here} prepareLogo={async (file) => file} />
      </ToastProvider>,
      'en',
    );
    return { api, onDone, ...view };
  };

  it('has the title, the helper, the logo circle and a start button that waits', () => {
    setup();
    expect(screen.getByRole('heading', { name: 'Set up your shop' })).toBeTruthy();
    expect(screen.getByText('Customers near you will see this name.')).toBeTruthy();
    expect(screen.getByText('Upload logo')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Upload logo · optional/);
    expect(screen.getByText('What do you sell? Pick up to 3.')).toBeTruthy();
    const start = screen.getByRole('button', {
      name: 'Start getting requests',
    }) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    expect(start.className).toContain('sh-btn--primary');
  });

  it('marks the three required parts with * and says so to assistive tech (S-01)', () => {
    setup();
    expect(screen.getByLabelText('Shop name').getAttribute('aria-required')).toBe('true');
    expect(screen.getByText('What do you sell? Pick up to 3.').className).toContain(
      'sh-label--required',
    );
    expect(screen.getByRole('heading', { name: 'Shop location' }).className).toContain(
      'sh-label--required',
    );
  });

  it('lists what is still missing while Start is off, and shrinks as it is filled (S-01)', async () => {
    const { user } = setup();
    const hint = () => document.querySelector('.sh-missing');
    expect(hint()?.textContent).toContain('Add your shop name');
    expect(hint()?.textContent).toContain('Pick what you sell');
    expect(hint()?.textContent).toContain(
      'Set your shop location: use your location or drag the pin',
    );
    await user.type(screen.getByLabelText('Shop name'), 'Sharma Kirana');
    expect(hint()?.textContent).not.toContain('Add your shop name');
    await user.click(screen.getByRole('button', { name: 'Grocery' }));
    expect(hint()?.textContent).not.toContain('Pick what you sell');
    await user.click(screen.getByRole('button', { name: 'Use my current location' }));
    await waitFor(() => expect(hint()).toBeNull());
  });

  it('says what to do next to the map when the location is blocked (S-01)', async () => {
    const api = fakeApi();
    const view = renderApp(
      <ToastProvider>
        <Setup api={api} onDone={vi.fn()} locate={async () => null} prepareLogo={async (f) => f} />
      </ToastProvider>,
      'en',
    );
    await view.user.click(screen.getByRole('button', { name: 'Use my current location' }));
    const section = (await screen.findByRole('heading', { name: 'Shop location' })).closest(
      'section',
    ) as HTMLElement;
    expect(within(section).getByText(/Location is blocked/)).toBeTruthy();
    expect(within(section).getByText('place pin')).toBeTruthy();
  });

  describe('the demo area for demo accounts (X-03)', () => {
    const demoApi = (demo: boolean | undefined = true) =>
      fakeApi({
        account: vi.fn(async () => ({ phoneMasked: '+91 90••• ••102', ...(demo && { demo }) })),
      });
    beforeEach(() => sessionStorage.clear());

    it('starts a demo shop on the demo place, says so, and Start needs only a name and a category', async () => {
      const { user, api, onDone } = setup(demoApi());
      expect(await screen.findByText(/Demo area: Vijay Nagar, Indore/)).toBeTruthy();
      expect(JSON.parse(screen.getByText('place pin').getAttribute('data-pin') as string)).toEqual({
        lat: DEMO_PLACE.lat,
        lng: DEMO_PLACE.lng,
      });
      expect(document.querySelector('.sh-missing')?.textContent).not.toContain('location');
      await user.type(screen.getByLabelText('Shop name'), 'Demo Kirana');
      await user.click(screen.getByRole('button', { name: 'Grocery' }));
      await user.click(screen.getByRole('button', { name: 'Start getting requests' }));
      await waitFor(() => expect(onDone).toHaveBeenCalled());
      expect(api.createShop).toHaveBeenCalledWith(
        expect.objectContaining({ lat: DEMO_PLACE.lat, lng: DEMO_PLACE.lng }),
      );
    });

    it('Change leaves the demo place: no banner, no place until the shop picks its real one', async () => {
      const { user } = setup(demoApi());
      await user.click(await screen.findByRole('button', { name: 'Change' }));
      expect(screen.queryByText(/Demo area/)).toBeNull();
      expect(document.querySelector('.sh-missing')?.textContent).toContain('location');
      await user.click(screen.getByRole('button', { name: 'Use my current location' }));
      await waitFor(() =>
        expect(document.querySelector('.sh-missing')?.textContent ?? '').not.toContain('location'),
      );
    });

    it('stays changed for the session (a new Setup does not bring the banner back)', async () => {
      const first = setup(demoApi());
      await first.user.click(await screen.findByRole('button', { name: 'Change' }));
      first.unmount();
      const api = demoApi();
      setup(api);
      await waitFor(() => expect(api.account).not.toHaveBeenCalled());
      expect(screen.queryByText(/Demo area/)).toBeNull();
    });

    it('leaves an ordinary shop alone', async () => {
      const api = demoApi(false);
      setup(api);
      await waitFor(() => expect(api.account).toHaveBeenCalled());
      expect(screen.queryByText(/Demo area/)).toBeNull();
      expect(document.querySelector('.sh-missing')?.textContent).toContain('location');
    });

    it('a failing account lookup changes nothing', async () => {
      const api = fakeApi({ account: vi.fn(async () => Promise.reject(new Error('offline'))) });
      setup(api);
      await waitFor(() => expect(api.account).toHaveBeenCalled());
      expect(screen.queryByText(/Demo area/)).toBeNull();
    });
  });

  describe('I deliver (S-02)', () => {
    const fillRequired = async (user: ReturnType<typeof setup>['user']) => {
      await user.type(screen.getByLabelText('Shop name'), 'Sharma Kirana');
      await user.click(screen.getByRole('button', { name: 'Grocery' }));
      await user.click(screen.getByRole('button', { name: 'Use my current location' }));
      await waitFor(() =>
        expect(
          (screen.getByRole('button', { name: 'Start getting requests' }) as HTMLButtonElement)
            .disabled,
        ).toBe(false),
      );
    };

    it('is a collapsed, optional section that opens on a tap', async () => {
      const { user } = setup();
      const toggle = screen.getByRole('button', { name: /I deliver/ });
      expect(toggle.textContent).toContain('optional');
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(screen.queryByLabelText('Default fee ₹')).toBeNull();
      await user.click(toggle);
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
      expect(screen.getByRole('switch', { name: 'I deliver' })).toBeTruthy();
    });

    it('sends nothing about delivery when it is left alone', async () => {
      const { user, api } = setup();
      await fillRequired(user);
      await user.click(screen.getByRole('button', { name: 'Start getting requests' }));
      await waitFor(() => expect(api.createShop).toHaveBeenCalled());
      expect(vi.mocked(api.createShop).mock.calls[0]?.[0]).not.toHaveProperty('delivery');
      expect(api.updateShop).not.toHaveBeenCalled();
    });

    it('creates the shop with the fee and time, then sets how far it delivers', async () => {
      const { user, api, onDone } = setup();
      await fillRequired(user);
      await user.click(screen.getByRole('button', { name: /I deliver/ }));
      await user.click(screen.getByRole('switch', { name: 'I deliver' }));
      await user.type(screen.getByLabelText('Default fee ₹'), '20');
      await user.click(screen.getByRole('button', { name: '30 min' }));
      await user.type(screen.getByLabelText('Deliver up to (km)'), '3');
      await user.click(screen.getByRole('button', { name: 'Start getting requests' }));
      await waitFor(() =>
        expect(api.createShop).toHaveBeenCalledWith(
          expect.objectContaining({ delivery: { feePaise: 2000, minutes: 30 } }),
        ),
      );
      await waitFor(() => expect(api.updateShop).toHaveBeenCalledWith({ deliveryMaxKm: 3 }));
      expect(onDone).toHaveBeenCalled();
    });

    it('does not start with a fee that is not a price, and says so', async () => {
      const { user, api } = setup();
      await fillRequired(user);
      await user.click(screen.getByRole('button', { name: /I deliver/ }));
      await user.click(screen.getByRole('switch', { name: 'I deliver' }));
      await user.type(screen.getByLabelText('Default fee ₹'), 'abc');
      await user.click(screen.getByRole('button', { name: 'Start getting requests' }));
      expect(await screen.findByText('Fee must be a number, like 20.')).toBeTruthy();
      expect(api.createShop).not.toHaveBeenCalled();
    });

    it('still finishes setup when the distance cannot be saved', async () => {
      const api = fakeApi({ updateShop: vi.fn(async () => Promise.reject(new Error('offline'))) });
      const { user, onDone } = setup(api);
      await fillRequired(user);
      await user.click(screen.getByRole('button', { name: /I deliver/ }));
      await user.click(screen.getByRole('switch', { name: 'I deliver' }));
      await user.type(screen.getByLabelText('Deliver up to (km)'), '3');
      await user.click(screen.getByRole('button', { name: 'Start getting requests' }));
      await waitFor(() => expect(onDone).toHaveBeenCalled());
    });
  });

  it('allows three kinds of goods at most, and says so', async () => {
    const { user } = setup();
    for (const name of ['Grocery', 'Dairy', 'Pooja items'])
      await user.click(screen.getByRole('button', { name }));
    expect(screen.getByText('You can pick up to 3. Remove one to pick another.')).toBeTruthy();
    const fourth = screen.getByRole('button', { name: 'Medical' }) as HTMLButtonElement;
    expect(fourth.disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Dairy' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    await user.click(screen.getByRole('button', { name: 'Dairy' }));
    expect((screen.getByRole('button', { name: 'Medical' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('creates the shop with the name, the kinds of goods and the pin', async () => {
    const { user, api, onDone } = setup();
    await user.type(screen.getByLabelText('Shop name'), '  Sharma Kirana ');
    await user.click(screen.getByRole('button', { name: 'Grocery' }));
    await user.click(screen.getByRole('button', { name: 'Use my current location' }));
    await user.click(await screen.findByRole('button', { name: 'place pin' }));
    await user.click(screen.getByRole('button', { name: 'Start getting requests' }));
    await waitFor(() =>
      expect(api.createShop).toHaveBeenCalledWith({
        name: 'Sharma Kirana',
        lat: 22.75,
        lng: 75.9,
        categories: ['grocery'],
      }),
    );
    expect(onDone).toHaveBeenCalled();
  });

  it('uploads the chosen logo after the shop exists', async () => {
    const { user, api, onDone } = setup();
    const file = new File(['x'], 'logo.png', { type: 'image/png' });
    await user.upload(document.querySelector('input[type="file"]') as HTMLInputElement, file);
    await user.type(screen.getByLabelText('Shop name'), 'Sharma Kirana');
    await user.click(screen.getByRole('button', { name: 'Grocery' }));
    await user.click(screen.getByRole('button', { name: 'Use my current location' }));
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Start getting requests' }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    await user.click(screen.getByRole('button', { name: 'Start getting requests' }));
    await waitFor(() => expect(api.uploadLogo).toHaveBeenCalled());
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ logoUrl: '/photos/logo-1' }));
  });

  it('still finishes setup when the logo cannot be uploaded', async () => {
    const api = fakeApi({ uploadLogo: vi.fn(async () => Promise.reject(new Error('big'))) });
    const { user, onDone } = setup(api);
    await user.upload(
      document.querySelector('input[type="file"]') as HTMLInputElement,
      new File(['x'], 'logo.png', { type: 'image/png' }),
    );
    await user.type(screen.getByLabelText('Shop name'), 'Sharma Kirana');
    await user.click(screen.getByRole('button', { name: 'Grocery' }));
    await user.click(screen.getByRole('button', { name: 'Use my current location' }));
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Start getting requests' }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    await user.click(screen.getByRole('button', { name: 'Start getting requests' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it('says what to do when the shop could not be created, and allows another try', async () => {
    const api = fakeApi({ createShop: vi.fn(async () => Promise.reject(new Error('offline'))) });
    const { user } = setup(api);
    await user.type(screen.getByLabelText('Shop name'), 'Sharma Kirana');
    await user.click(screen.getByRole('button', { name: 'Grocery' }));
    await user.click(screen.getByRole('button', { name: 'Use my current location' }));
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Start getting requests' }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    await user.click(screen.getByRole('button', { name: 'Start getting requests' }));
    expect(
      await screen.findByText("Couldn't create your shop. Check your connection and try again."),
    ).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Start getting requests' }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });
});

describe('Settings: the account (A-09)', () => {
  it('shows who is logged in with the number hidden until the eye is pressed', async () => {
    const api = fakeApi();
    const { user } = renderApp(
      <ToastProvider>
        <Settings
          api={api}
          shop={shop({ name: 'Sharma Kirana' })}
          onSaved={vi.fn()}
          onLoggedOut={vi.fn()}
          prepareLogo={async (f) => f}
          locate={here}
        />
      </ToastProvider>,
      'en',
    );
    expect(await screen.findByText('Logged in as')).toBeTruthy();
    expect(screen.queryByText('+91 90••• ••102')).toBeNull();
    expect(api.revealPhone).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Show phone number' }));
    expect(await screen.findByText('+91 90000 00102')).toBeTruthy();
  });
});

describe('Settings', () => {
  const mine = shop({ name: 'Sharma Kirana', categories: ['grocery'], logoUrl: '/photos/old' });
  const setup = (current = mine, api = fakeApi()) => {
    const onSaved = vi.fn();
    const onLoggedOut = vi.fn();
    const view = renderApp(
      <ToastProvider>
        <Settings
          api={api}
          shop={current}
          onSaved={onSaved}
          onLoggedOut={onLoggedOut}
          prepareLogo={async (f) => f}
          locate={here}
        />
      </ToastProvider>,
      'en',
    );
    return { api, onSaved, onLoggedOut, ...view };
  };

  it('shows the logo as a tappable circle with a quiet remove link, or just the circle when there is none', () => {
    const first = setup();
    const circle = screen.getByRole('button', { name: 'Change logo' });
    expect(circle.className).toContain('sh-logopick__circle');
    expect(circle.querySelector('.sh-logopick__plus')).toBeTruthy();
    expect(circle.querySelector('img, .sh-logo')).toBeTruthy();
    const remove = screen.getByRole('button', { name: 'Remove logo' });
    expect(remove.className).toContain('sh-btn--quiet');
    first.unmount();
    setup(shop({ logoUrl: null }));
    expect(screen.getByRole('button', { name: 'Change logo' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Remove logo' })).toBeNull();
  });

  it('has a quiet "Log out on all devices" that asks first (ADR-0060)', async () => {
    const { user, api, onLoggedOut } = setup();
    const open = screen.getByRole('button', { name: 'Log out on all devices' });
    expect(open.className).not.toContain('sh-btn--primary');
    await user.click(open);
    const sheet = screen.getByRole('dialog', { name: 'Log out on all devices?' });
    await user.click(within(sheet).getByRole('button', { name: 'Stay logged in' }));
    expect(api.logoutAll).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Log out on all devices' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Log out everywhere' }),
    );
    await waitFor(() => expect(onLoggedOut).toHaveBeenCalled());
    expect(api.logoutAll).toHaveBeenCalledTimes(1);
  });

  it('stays logged in and says what to do when logging out everywhere fails', async () => {
    const api = fakeApi({ logoutAll: vi.fn(async () => Promise.reject(new Error('offline'))) });
    const { user, onLoggedOut } = setup(mine, api);
    await user.click(screen.getByRole('button', { name: 'Log out on all devices' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Log out everywhere' }),
    );
    expect(
      await screen.findByText("Couldn't log out everywhere. Check your connection and try again."),
    ).toBeTruthy();
    expect(onLoggedOut).not.toHaveBeenCalled();
  });

  it('opens the file picker when the circle is tapped', async () => {
    const { user } = setup();
    const picker = document.querySelector('input[type="file"]') as HTMLInputElement;
    const click = vi.spyOn(picker, 'click');
    await user.click(screen.getByRole('button', { name: 'Change logo' }));
    expect(click).toHaveBeenCalled();
  });

  it('uploads a new logo as soon as it is picked', async () => {
    const { user, api, onSaved } = setup();
    await user.upload(
      document.querySelector('input[type="file"]') as HTMLInputElement,
      new File(['x'], 'logo.png', { type: 'image/png' }),
    );
    await waitFor(() => expect(api.uploadLogo).toHaveBeenCalled());
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ logoUrl: '/photos/logo-1' }));
  });

  it('says what to do when the logo cannot be uploaded', async () => {
    const api = fakeApi({
      uploadLogo: vi.fn(async () => Promise.reject(new ApiError(413, 'photo_too_large', 'x'))),
    });
    const { user } = setup(mine, api);
    await user.upload(
      document.querySelector('input[type="file"]') as HTMLInputElement,
      new File(['x'], 'logo.png', { type: 'image/png' }),
    );
    expect(
      await screen.findByText("Couldn't upload the logo. Try a smaller picture."),
    ).toBeTruthy();
  });

  it('asks in a bottom sheet before removing the logo, and keeps it on cancel', async () => {
    const { user, api, onSaved } = setup();
    await user.click(screen.getByRole('button', { name: 'Remove logo' }));
    const sheet = screen.getByRole('dialog', { name: 'Remove your logo?' });
    expect(api.deleteLogo).not.toHaveBeenCalled();
    await user.click(within(sheet).getByRole('button', { name: 'Keep logo' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.deleteLogo).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('removes the logo once it is confirmed', async () => {
    const { user, api, onSaved } = setup();
    await user.click(screen.getByRole('button', { name: 'Remove logo' }));
    const sheet = screen.getByRole('dialog', { name: 'Remove your logo?' });
    await user.click(within(sheet).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(api.deleteLogo).toHaveBeenCalled());
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ logoUrl: null }));
    expect(await screen.findByText('Logo removed.')).toBeTruthy();
  });

  it('keeps Save off until something changed, then sends only what changed', async () => {
    const { user, api, onSaved } = setup();
    const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    const name = screen.getByLabelText('Shop name');
    await user.clear(name);
    await user.type(name, 'Sharma Store');
    await user.click(screen.getByRole('button', { name: 'Dairy' }));
    expect(save.disabled).toBe(false);
    await user.click(save);
    await waitFor(() =>
      expect(api.updateShop).toHaveBeenCalledWith({
        name: 'Sharma Store',
        categories: ['grocery', 'dairy'],
      }),
    );
    expect(onSaved).toHaveBeenCalled();
    expect(await screen.findByText('Saved.')).toBeTruthy();
  });

  it('moves the pin and saves both coordinates together', async () => {
    const { user, api } = setup();
    await user.click(screen.getByRole('button', { name: 'place pin' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.updateShop).toHaveBeenCalledWith({ lat: 22.75, lng: 75.9 }));
  });

  it('needs a name and at least one kind of goods', async () => {
    const { user, api } = setup();
    await user.clear(screen.getByLabelText('Shop name'));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('Add your shop name to continue.')).toBeTruthy();
    expect(api.updateShop).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText('Shop name'), 'X');
    await user.click(screen.getByRole('button', { name: 'Grocery' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('Pick what you sell to continue.')).toBeTruthy();
    expect(within(document.body).queryByText('Saved.')).toBeNull();
  });
});
