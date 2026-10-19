// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderApp } from '../../test/render.js';
import { BottomSheet } from '../../ui/BottomSheet.js';
import { ShopHeader } from './ShopHeader.js';
import { ShopLogo, initialsOf } from './ShopLogo.js';
import { Sidebar } from './Sidebar.js';
import { ToastProvider } from '../../ui/Toast.js';

describe('initialsOf', () => {
  it('takes the first letters of the first two words', () => {
    expect(initialsOf('Sharma Kirana Store')).toBe('SK');
    expect(initialsOf('  gupta  ')).toBe('G');
    expect(initialsOf('')).toBe('?');
  });
});

describe('ShopLogo', () => {
  it('shows the logo when there is one and initials when there is not', () => {
    const { rerender } = renderApp(
      <ShopLogo name="Sharma Kirana" logoUrl="/photos/1" size={40} />,
      'en',
    );
    expect(document.querySelector('img')?.getAttribute('src')).toBe('/photos/1');
    rerender(<ShopLogo name="Sharma Kirana" logoUrl={null} size={40} />);
    expect(screen.getByText('SK')).toBeTruthy();
  });
});

describe('BottomSheet', () => {
  it('is a modal dialog with a title, a close button and a sticky footer', async () => {
    const onClose = vi.fn();
    const { user } = renderApp(
      <BottomSheet open title="Atta · 5 kg" onClose={onClose} footer={<button>Send</button>}>
        <input aria-label="Price" />
      </BottomSheet>,
      'en',
    );
    const dialog = screen.getByRole('dialog', { name: 'Atta · 5 kg' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape and renders nothing when closed', async () => {
    const onClose = vi.fn();
    const { user, rerender } = renderApp(
      <BottomSheet open title="T" onClose={onClose}>
        <input aria-label="Price" />
      </BottomSheet>,
      'en',
    );
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
    rerender(
      <BottomSheet open={false} title="T" onClose={onClose}>
        <input aria-label="Price" />
      </BottomSheet>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps Tab inside the sheet and puts focus in it when it opens', async () => {
    const { user } = renderApp(
      <>
        <button>behind</button>
        <BottomSheet open title="T" onClose={vi.fn()} footer={<button>Send</button>}>
          <input aria-label="Price" />
        </BottomSheet>
      </>,
      'en',
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog.contains(document.activeElement)).toBe(true);
    for (let i = 0; i < 6; i++) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    await user.tab({ shift: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('returns focus to what opened it', () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const { rerender } = renderApp(
      <BottomSheet open title="T" onClose={vi.fn()}>
        <input aria-label="Price" />
      </BottomSheet>,
      'en',
    );
    rerender(
      <BottomSheet open={false} title="T" onClose={vi.fn()}>
        <input aria-label="Price" />
      </BottomSheet>,
    );
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});

const header = (over: Partial<Parameters<typeof ShopHeader>[0]> = {}) => (
  <ToastProvider>
    <ShopHeader
      name="Sharma Kirana"
      logoUrl={null}
      open
      onMenu={vi.fn()}
      onToggleOpen={vi.fn(async () => undefined)}
      {...over}
    />
  </ToastProvider>
);

describe('ShopHeader', () => {
  it('shows the name, a menu button and an Open switch', () => {
    renderApp(header(), 'en');
    expect(screen.getByText('Sharma Kirana')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Menu' })).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Open' }).getAttribute('aria-checked')).toBe('true');
  });

  it('shows a round knob on the switch, on the right when open and on the left when closed', () => {
    const { rerender } = renderApp(header(), 'en');
    const pill = screen.getByRole('switch', { name: 'Open' });
    expect(pill.querySelector('.sh-pill__knob')).toBeTruthy();
    expect(pill.className).toContain('sh-pill--open');
    rerender(header({ open: false }));
    expect(screen.getByRole('switch', { name: 'Closed' }).className).toContain('sh-pill--closed');
  });

  it('opens the menu', async () => {
    const onMenu = vi.fn();
    const { user } = renderApp(header({ onMenu }), 'en');
    await user.click(screen.getByRole('button', { name: 'Menu' }));
    expect(onMenu).toHaveBeenCalled();
  });

  it('closes the shop and says what that means', async () => {
    const onToggleOpen = vi.fn(async () => undefined);
    const { user } = renderApp(header({ onToggleOpen }), 'en');
    await user.click(screen.getByRole('switch', { name: 'Open' }));
    expect(onToggleOpen).toHaveBeenCalledWith(false);
    expect(await screen.findByText("You're closed. You won't get new requests.")).toBeTruthy();
  });

  it('opens the shop and says so', async () => {
    const onToggleOpen = vi.fn(async () => undefined);
    const { user } = renderApp(header({ open: false, onToggleOpen }), 'en');
    expect(screen.getByRole('switch', { name: 'Closed' }).getAttribute('aria-checked')).toBe(
      'false',
    );
    await user.click(screen.getByRole('switch', { name: 'Closed' }));
    expect(onToggleOpen).toHaveBeenCalledWith(true);
    expect(await screen.findByText("You're open.")).toBeTruthy();
  });

  it('says what to do when the change fails, and shows no success toast', async () => {
    const onToggleOpen = vi.fn(async () => {
      throw new Error('offline');
    });
    const { user } = renderApp(header({ onToggleOpen }), 'en');
    await user.click(screen.getByRole('switch', { name: 'Open' }));
    expect(
      await screen.findByText("Couldn't change. Check your connection and try again."),
    ).toBeTruthy();
    expect(screen.queryByText("You're closed. You won't get new requests.")).toBeNull();
  });
});

describe('Sidebar', () => {
  const props = {
    open: true,
    onClose: vi.fn(),
    onLogout: vi.fn(),
    shop: { name: 'Sharma Kirana', logoUrl: null, open: true },
    view: 'requests' as const,
    pendingCount: 3,
    activeOrders: 2,
  };

  it('lists the six places, the counts, log out and the brand', () => {
    renderApp(<Sidebar {...props} />, 'en');
    for (const name of [
      'Requests',
      'Orders',
      'Insights',
      'Delivery',
      'Notifications',
      'Shop settings',
    ])
      expect(screen.getByRole('link', { name: new RegExp(name) })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Requests/ }).textContent).toContain('3');
    expect(screen.getByText('2 active')).toBeTruthy();
    expect(screen.getByText('Open now')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Log out' })).toBeTruthy();
    expect(screen.getByText(/Powered by KahanMilega/)).toBeTruthy();
  });

  it('marks the current place and links by hash', () => {
    renderApp(<Sidebar {...props} view="orders" />, 'en');
    expect(screen.getByRole('link', { name: /Orders/ }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: /Insights/ }).getAttribute('href')).toBe('#/insights');
  });

  it('closes on a link, on Escape and on the scrim, and says Closed for a closed shop', async () => {
    const onClose = vi.fn();
    const { user } = renderApp(
      <Sidebar {...props} onClose={onClose} shop={{ ...props.shop, open: false }} />,
      'en',
    );
    expect(screen.getByText('Closed')).toBeTruthy();
    await user.click(screen.getByRole('link', { name: /Orders/ }));
    await user.keyboard('{Escape}');
    await user.click(screen.getByTestId('scrim'));
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('traps focus while open and is not in the page when closed', async () => {
    const { user, rerender } = renderApp(<Sidebar {...props} />, 'en');
    const drawer = screen.getByRole('dialog', { name: 'Main menu' });
    for (let i = 0; i < 12; i++) {
      await user.tab();
      expect(drawer.contains(document.activeElement)).toBe(true);
    }
    rerender(<Sidebar {...props} open={false} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
