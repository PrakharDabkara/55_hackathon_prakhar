// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api.js';
import { fakeApi, shop } from '../../test/fakes.js';
import { renderApp } from '../../test/render.js';
import { ToastProvider } from '../ui/Toast.js';
import { Login } from './Login.js';
import { Settings } from './Settings.js';
import { Setup } from './Setup.js';

// jsdom cannot draw a map: this stand-in moves the pin with a button.
vi.mock('../ui/PinMap.js', () => ({
  PinMap: ({ onMove }: { onMove: (p: { lat: number; lng: number }) => void }) => (
    <button onClick={() => onMove({ lat: 22.75, lng: 75.9 })}>place pin</button>
  ),
}));

const here = async () => ({ lat: 22.7, lng: 75.8 });

describe('Login', () => {
  it('shows the brand once, who it is for, a +91 field, a helper and the one primary button', () => {
    renderApp(<Login api={fakeApi()} onLoggedIn={vi.fn()} />, 'en');
    expect(screen.getByRole('heading', { name: 'KahanMilega' })).toBeTruthy();
    expect(screen.getByText('For shops')).toBeTruthy();
    expect(screen.getByLabelText('Mobile number')).toBeTruthy();
    expect(screen.getByText('+91')).toBeTruthy();
    expect(screen.getByText("We'll send a 6-digit code by SMS.")).toBeTruthy();
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
    expect(screen.getByText('Enter a 10-digit mobile number.')).toBeTruthy();
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
    expect(screen.getByText('Upload logo · optional')).toBeTruthy();
    expect(screen.getByText('What do you sell? Pick up to 3.')).toBeTruthy();
    const start = screen.getByRole('button', {
      name: 'Start getting requests',
    }) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    expect(start.className).toContain('sh-btn--primary');
  });

  it('never mentions delivery', () => {
    setup();
    expect(document.body.textContent).not.toMatch(/deliver/i);
  });

  it('says what is still missing, one thing at a time', async () => {
    const { user } = setup();
    expect(screen.getByText('Add your shop name to continue.')).toBeTruthy();
    await user.type(screen.getByLabelText('Shop name'), 'Sharma Kirana');
    expect(screen.getByText('Pick what you sell to continue.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Grocery' }));
    expect(screen.getByText('Set your shop location to continue.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Use my current location' }));
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Start getting requests' }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
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

describe('Settings', () => {
  const mine = shop({ name: 'Sharma Kirana', categories: ['grocery'], logoUrl: '/photos/old' });
  const setup = (current = mine, api = fakeApi()) => {
    const onSaved = vi.fn();
    const view = renderApp(
      <ToastProvider>
        <Settings
          api={api}
          shop={current}
          onSaved={onSaved}
          prepareLogo={async (f) => f}
          locate={here}
        />
      </ToastProvider>,
      'en',
    );
    return { api, onSaved, ...view };
  };

  it('shows the logo with change and remove, or just upload when there is none', () => {
    const first = setup();
    expect(screen.getByRole('button', { name: 'Change logo' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove logo' })).toBeTruthy();
    first.unmount();
    setup(shop({ logoUrl: null }));
    expect(screen.getByRole('button', { name: 'Change logo' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Remove logo' })).toBeNull();
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

  it('removes the logo', async () => {
    const { user, api, onSaved } = setup();
    await user.click(screen.getByRole('button', { name: 'Remove logo' }));
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
