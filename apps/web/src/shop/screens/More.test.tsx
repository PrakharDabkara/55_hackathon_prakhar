// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ShopDemand } from '../../lib/api.js';
import type { PushClient, PushStatus } from '../../lib/push.js';
import { fakeApi, fakePush, shop } from '../../test/fakes.js';
import { renderApp } from '../../test/render.js';
import { ToastProvider } from '../../ui/Toast.js';
import { Delivery } from './Delivery.js';
import { Insights } from './Insights.js';
import { Notifications } from './Notifications.js';

const demand = (over: Partial<ShopDemand> = {}): ShopDemand => ({
  days: 1,
  today: { received: 7, answered: 5, yes: 3 },
  avgReplySeconds: 100,
  asked: [
    { item: { nameEn: 'cumin', nameHi: 'जीरा' }, count: 4 },
    { item: { nameEn: 'ghee', nameHi: 'घी' }, count: 1 },
  ],
  nearby: [
    { item: { nameEn: 'atta', nameHi: 'आटा' }, customers: 8 },
    { item: { nameEn: 'rice', nameHi: 'चावल' }, customers: 4 },
  ],
  ...over,
});

describe('Insights', () => {
  const setup = (value: ShopDemand | Error = demand()) => {
    const api = fakeApi({
      shopDemand: vi.fn(async (days = 1) => {
        if (value instanceof Error) throw value;
        return { ...value, days };
      }),
    });
    return { api, ...renderApp(<Insights api={api} />, 'en') };
  };

  it('shows the four numbers', async () => {
    setup();
    expect(await screen.findByText('Requests')).toBeTruthy();
    const tile = (label: string) => screen.getByText(label).closest('.sh-tile') as HTMLElement;
    expect(within(tile('Requests')).getByText('7')).toBeTruthy();
    expect(within(tile('You answered')).getByText('5')).toBeTruthy();
    const inStock = tile('Said "in stock"');
    expect(within(inStock).getByText('3').className).toContain('sh-figure--brand');
    expect(within(tile('Average reply time')).getByText('1m 40s')).toBeTruthy();
  });

  it('shows a dash when there is no reply time yet', async () => {
    setup(demand({ avgReplySeconds: null }));
    await screen.findByText('Requests');
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('switches between today and 7 days, asking the server each time', async () => {
    const { user, api } = setup();
    await screen.findByText('Requests');
    expect(api.shopDemand).toHaveBeenLastCalledWith(1);
    await user.click(screen.getByRole('button', { name: '7 days' }));
    await waitFor(() => expect(api.shopDemand).toHaveBeenLastCalledWith(7));
    expect(screen.getByRole('button', { name: '7 days' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('draws the most-asked items as bars relative to the biggest', async () => {
    setup();
    const list = await screen.findByRole('list', { name: 'Most asked near you' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows[0]?.textContent).toContain('Atta');
    expect(rows[0]?.textContent).toContain('8');
    const bars = [...list.querySelectorAll<HTMLElement>('.sh-bar__fill')].map((b) => b.style.width);
    expect(bars).toEqual(['100%', '50%']);
  });

  it('says so when there are too few nearby requests', async () => {
    setup(demand({ nearby: [] }));
    expect(await screen.findByText('Not enough nearby requests yet.')).toBeTruthy();
  });

  it('lists what the shop said no to', async () => {
    setup();
    const list = await screen.findByRole('list', { name: 'You said no to' });
    expect(within(list).getByText('Cumin')).toBeTruthy();
    expect(within(list).getByText('4')).toBeTruthy();
  });

  it('shows a skeleton first and an error with a retry after a failure', async () => {
    const { user, api } = setup(new Error('offline'));
    expect(screen.getByText('Loading')).toBeTruthy();
    expect(
      await screen.findByText("Couldn't load. Check your connection and try again."),
    ).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(api.shopDemand).toHaveBeenCalledTimes(2));
  });
});

describe('Delivery', () => {
  const setup = (mine = shop()) => {
    const api = fakeApi();
    const setShop = vi.fn();
    const view = renderApp(
      <ToastProvider>
        <Delivery api={api} shop={mine} onSaved={setShop} />
      </ToastProvider>,
      'en',
    );
    return { api, setShop, ...view };
  };

  it('starts from what the shop has saved', () => {
    setup(
      shop({ deliversDefault: true, defaultFeePaise: 2000, defaultMinutes: 30, deliveryMaxKm: 3 }),
    );
    expect(screen.getByRole('switch', { name: 'I deliver' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    expect((screen.getByLabelText('Default fee ₹') as HTMLInputElement).value).toBe('20');
    expect(screen.getByRole('button', { name: '30 min' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect((screen.getByLabelText('Deliver up to (km)') as HTMLInputElement).value).toBe('3');
  });

  it('hides the details while the shop does not deliver', () => {
    setup();
    expect(screen.queryByLabelText('Default fee ₹')).toBeNull();
    expect(screen.queryByLabelText('Deliver up to (km)')).toBeNull();
  });

  it('saves the offer, the time and the limit in one go', async () => {
    const { user, api, setShop } = setup();
    await user.click(screen.getByRole('switch', { name: 'I deliver' }));
    await user.type(screen.getByLabelText('Default fee ₹'), '25');
    await user.click(screen.getByRole('button', { name: '1 hour' }));
    await user.type(screen.getByLabelText('Deliver up to (km)'), '2.5');
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save.className).toContain('sh-btn--primary');
    await user.click(save);
    await waitFor(() =>
      expect(api.updateShop).toHaveBeenCalledWith({
        delivery: { feePaise: 2500, minutes: 60 },
        deliveryMaxKm: 2.5,
      }),
    );
    expect(setShop).toHaveBeenCalled();
    expect(await screen.findByText('Saved.')).toBeTruthy();
  });

  it('stops delivering with a null offer, and an empty limit means no limit', async () => {
    const { user, api } = setup(
      shop({ deliversDefault: true, defaultFeePaise: 2000, defaultMinutes: 30, deliveryMaxKm: 3 }),
    );
    await user.clear(screen.getByLabelText('Deliver up to (km)'));
    await user.click(screen.getByRole('switch', { name: 'I deliver' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.updateShop).toHaveBeenCalledWith({ delivery: null, deliveryMaxKm: null }),
    );
  });

  it('says what is wrong with a fee or a distance and saves nothing', async () => {
    const { user, api } = setup(
      shop({ deliversDefault: true, defaultFeePaise: 2000, defaultMinutes: 30 }),
    );
    const fee = screen.getByLabelText('Default fee ₹');
    await user.clear(fee);
    await user.type(fee, 'abc');
    await user.type(screen.getByLabelText('Deliver up to (km)'), '500');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('Fee must be a number, like 20.')).toBeTruthy();
    expect(screen.getByText('Distance must be between 0.1 and 100 km.')).toBeTruthy();
    expect(api.updateShop).not.toHaveBeenCalled();
  });

  it('says what to do when saving fails', async () => {
    const api = fakeApi({ updateShop: vi.fn(async () => Promise.reject(new Error('offline'))) });
    const { user } = renderApp(
      <ToastProvider>
        <Delivery api={api} shop={shop()} onSaved={vi.fn()} />
      </ToastProvider>,
      'en',
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByText("Couldn't send. Check your connection and try again."),
    ).toBeTruthy();
  });
});

describe('Notifications', () => {
  const client = (status: PushStatus): PushClient => {
    let current = status;
    return {
      status: vi.fn(async () => current),
      enable: vi.fn(async () => {
        current = 'on';
        return 'on' as const;
      }),
      disable: vi.fn(async () => {
        current = 'off';
      }),
      resync: vi.fn(async () => undefined),
    };
  };
  const setup = (status: PushStatus) => {
    const push = client(status);
    return { push, ...renderApp(<Notifications api={fakePush()} pushClient={push} />, 'en') };
  };

  it('turns notifications on only after a tap, then offers to turn them off', async () => {
    const { user, push } = setup('off');
    const on = await screen.findByRole('button', { name: 'Turn on notifications' });
    expect(push.enable).not.toHaveBeenCalled();
    await user.click(on);
    expect(await screen.findByText('Notifications are on')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Turn off' }));
    expect(push.disable).toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: 'Turn on notifications' })).toBeTruthy();
  });

  it('explains a blocked browser and an iPhone that needs the Home Screen', async () => {
    const blocked = setup('blocked');
    expect(
      await screen.findByText('Notifications are blocked. Allow them in your browser settings.'),
    ).toBeTruthy();
    blocked.unmount();
    setup('ios_install');
    expect(
      await screen.findByText('On iPhone, add this app to your Home Screen first.'),
    ).toBeTruthy();
  });

  it('says so when this browser cannot show notifications, instead of an empty card', async () => {
    setup('unsupported');
    expect(
      await screen.findByText(
        "This browser can't show notifications. Keep this page open to see new requests.",
      ),
    ).toBeTruthy();
  });

  it('says what to do when turning on fails', async () => {
    const push = client('off');
    push.enable = vi.fn(async () => 'failed' as const);
    const { user } = renderApp(<Notifications api={fakePush()} pushClient={push} />, 'en');
    await user.click(await screen.findByRole('button', { name: 'Turn on notifications' }));
    expect(await screen.findByText("Couldn't turn on notifications. Try again.")).toBeTruthy();
  });
});
