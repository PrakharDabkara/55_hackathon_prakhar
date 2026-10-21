// @vitest-environment jsdom
import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { roundTripM } from '../lib/errand.js';
import { formatDistance } from '../lib/format.js';
import { errandPlan, fakePickups, planItem } from '../test/fakes.js';
import { deliveringItem, lostItem, planWithItems, samePlan } from '../test/fakesErrand.js';
import { renderApp } from '../test/render.js';
import { ErrandResult } from './ErrandResult.js';

vi.mock('../components/PlanMap.js', () => ({
  PlanMap: (props: { stops: { n: number }[] }) => (
    <div data-testid="plan-map" data-stops={props.stops.length} />
  ),
}));

const origin = { lat: 22.7196, lng: 75.8577 };

function show(plan = errandPlan(), props: Partial<Parameters<typeof ErrandResult>[0]> = {}) {
  return renderApp(<ErrandResult plan={plan} origin={origin} {...props} />, 'en');
}
const tiles = () => screen.getByRole('region', { name: 'Plan at a glance' });

describe('the recommended plan first', () => {
  it('opens on the recommended variant, its stops numbered in route order', () => {
    show();
    const stops = screen.getByRole('list', { name: 'Stops in order' });
    expect(stops.querySelectorAll(':scope > li')).toHaveLength(1);
    expect(within(stops).getByLabelText('Stop 1: Mishra Kirana')).toBeTruthy();
    expect(screen.queryByText(/Gupta Store/)).toBeNull();
  });

  it('shows the other variant on "See other options" and goes back', async () => {
    const { user } = show();
    await user.click(screen.getByRole('button', { name: 'See other options' }));
    expect(screen.getByLabelText('Stop 1: Mishra Kirana')).toBeTruthy();
    expect(screen.getByLabelText('Stop 2: Gupta Store')).toBeTruthy();
    expect(within(tiles()).getByText('₹125')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Back to the suggested plan' }));
    expect(screen.queryByText(/Gupta Store/)).toBeNull();
  });

  it('offers no other options when both plans have the same shops and total', () => {
    show(samePlan());
    expect(screen.queryByRole('button', { name: 'See other options' })).toBeNull();
  });

  it('shows the cheaper plan first when that is the recommended one', () => {
    show(
      errandPlan({
        recommended: 'sasta',
        recommendation: { extraPaise: 4000, stopsSaved: 1, reason: 'fewer_stops_too_dear' },
      }),
    );
    expect(screen.getByLabelText('Stop 2: Gupta Store')).toBeTruthy();
  });
});

describe('the three tiles', () => {
  it('shows shops, the round trip (route plus the way back) and the total', () => {
    const plan = errandPlan();
    show(plan);
    const expected = formatDistance(roundTripM(origin, plan.plans.kam_dukaan.route) as number);
    const t = within(tiles());
    expect(t.getByText('Shops').nextElementSibling?.textContent).toBe('1');
    expect(t.getByText('Round trip').nextElementSibling?.textContent).toBe(expected);
    expect(t.getByText('Total').nextElementSibling?.textContent).toBe('₹150');
  });

  it('says "Stops" with the stop count when there is no route to measure', () => {
    show(
      planWithItems([planItem(), planItem({ shopId: 's2', shopName: 'Gupta Store' })], {
        route: null,
      }),
    );
    const t = within(tiles());
    expect(t.queryByText('Round trip')).toBeNull();
    expect(t.getByText('Stops').nextElementSibling?.textContent).toBe('2');
  });

  it('uses the grand total when delivery is chosen', () => {
    show(samePlan({ grandTotalPaise: 18000, deliveryShopCount: 1 }));
    expect(within(tiles()).getByText('₹180')).toBeTruthy();
  });

  it('says how many prices are unknown, and shows "Price unknown" rather than ₹0', () => {
    show(
      planWithItems(
        [
          planItem({ text: 'chai patti', itemName: 'tea leaves', pricePaise: 9900 }),
          planItem({ text: 'chini', itemName: 'sugar', pricePaise: null }),
        ],
        { unknownPriceCount: 1, totalPricePaise: 9900 },
      ),
    );
    expect(within(tiles()).getByText('+1 price unknown')).toBeTruthy();
    expect(screen.getByText('Price unknown')).toBeTruthy();
    expect(screen.queryByText('₹0')).toBeNull();
  });

  it('has no "price unknown" note when every price is known', () => {
    show();
    expect(screen.queryByText(/price unknown/)).toBeNull();
  });
});

describe('the page', () => {
  it('says AI picked the plan and can be wrong', () => {
    show();
    expect(
      screen.getByText(
        "AI picked this plan for the shortest trip with every item in stock, using the shops' own answers. It can make mistakes: check the stops before you go.",
      ),
    ).toBeTruthy();
  });

  it('draws the route and has one primary button: Start route', () => {
    const { container } = show();
    expect(screen.getByTestId('plan-map')).toBeTruthy();
    const link = screen.getByRole('link', { name: 'Start route' });
    expect(link.getAttribute('href')).toMatch(
      /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&origin=/,
    );
    expect(link.getAttribute('target')).toBe('_blank');
    expect(container.querySelectorAll('.sh-btn--primary')).toHaveLength(1);
  });

  it('shows the server freshness text and the price on an item line', () => {
    show();
    const stop = screen.getByLabelText('Stop 1: Mishra Kirana');
    const line = within(stop).getByText('Tea leaves').closest('li') as HTMLElement;
    expect(within(line).getByText('₹99')).toBeTruthy();
    expect(within(line).getByText('Confirmed 2 min ago')).toBeTruthy();
  });

  it('groups items nobody has under a quiet "Not found"', () => {
    show(planWithItems([planItem(), lostItem()]));
    const group = screen.getByRole('list', { name: 'Not found' });
    expect(within(group).getByText('unicorn')).toBeTruthy();
    expect(within(group).queryByText(/₹/)).toBeNull();
  });

  it('nothing found: no tiles, no map, no Start route; "Ask shops again" asks again', async () => {
    const onAskAgain = vi.fn();
    const { user } = show(
      planWithItems([lostItem(), lostItem({ text: 'dragon' })], { route: null, shopCount: 0 }),
      {
        onAskAgain,
      },
    );
    expect(screen.getByText('No shop has answered yet.')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Plan at a glance' })).toBeNull();
    expect(screen.queryByTestId('plan-map')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Start route' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Ask shops again' }));
    expect(onAskAgain).toHaveBeenCalled();
  });

  it('explains a blocked item and does not offer to ask again', () => {
    show(planWithItems([lostItem({ refused: 'blocked' })], { route: null }), {
      onAskAgain: vi.fn(),
    });
    expect(screen.getByText("We can't send this item to shops")).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Ask shops again' })).toBeNull();
  });

  it('shows the shop photo, the tags and the "matched as" note', () => {
    show(
      planWithItems([
        planItem({
          isNew: true,
          customerVerified: true,
          matchedAs: true,
          text: 'diya',
          itemName: 'candle',
        }),
      ]),
    );
    expect(screen.getByText('New item')).toBeTruthy();
    expect(screen.getByText('Confirmed by a customer')).toBeTruthy();
    expect(screen.getByText("You said 'diya' — the shop confirmed 'candle'")).toBeTruthy();
  });
});

describe('pickup or delivery', () => {
  it('shows the mode on the stop and a pickup/delivery control only when the shop delivers', () => {
    show(planWithItems([deliveringItem()]), { onMode: vi.fn() });
    expect(screen.getByText('You pick up')).toBeTruthy();
    const control = screen.getByRole('group', { name: 'How to get it from Mishra Kirana' });
    expect(
      within(control).getByRole('button', { name: 'Pick up' }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(
      within(control).getByRole('button', { name: 'Delivery' }).getAttribute('aria-pressed'),
    ).toBe('false');
  });

  it('says "Delivers · ₹30" once delivery is chosen', () => {
    show(planWithItems([deliveringItem({ mode: 'delivery' })]), { onMode: vi.fn() });
    expect(screen.getByText('Delivers · ₹30')).toBeTruthy();
  });

  it('has no control for a shop that does not deliver', () => {
    show(planWithItems([planItem()]), { onMode: vi.fn() });
    expect(screen.queryByRole('button', { name: 'Delivery' })).toBeNull();
  });

  it('asks the server to switch the shop', async () => {
    const onMode = vi.fn();
    const { user } = show(planWithItems([deliveringItem()]), { onMode });
    await user.click(screen.getByRole('button', { name: 'Delivery' }));
    expect(onMode).toHaveBeenCalledWith('s1', 'delivery');
  });
});

describe('"Start route" records the visits (ADR-0035)', () => {
  const noNavigation = (event: Event) => event.preventDefault();
  async function start(user: ReturnType<typeof show>['user']) {
    const link = screen.getByRole('link', { name: 'Start route' });
    link.addEventListener('click', noNavigation);
    await user.click(link);
  }
  const withPickups = (items: Parameters<typeof planWithItems>[0], pickups = fakePickups()) => ({
    pickups,
    ...show(planWithItems(items), { pickupApi: pickups, errandId: 'errand-7' }),
  });

  it('records each pickup shop and item once', async () => {
    const { pickups, user } = withPickups([
      planItem({ itemId: 'i-tea', shopId: 's1' }),
      planItem({ itemId: 'i-sugar', shopId: 's2', status: 'likely' }),
    ]);
    await start(user);
    expect(pickups.recordPickup).toHaveBeenCalledTimes(2);
    expect(pickups.recordPickup).toHaveBeenCalledWith({
      shopId: 's1',
      itemId: 'i-tea',
      errandId: 'errand-7',
    });
    expect(pickups.recordPickup).toHaveBeenCalledWith({
      shopId: 's2',
      itemId: 'i-sugar',
      errandId: 'errand-7',
    });
  });

  it('leaves out delivery shops and items nobody found', async () => {
    const { pickups, user } = withPickups([
      planItem({ itemId: 'i-tea', shopId: 's1' }),
      planItem({ itemId: 'i-sugar', shopId: 's2', mode: 'delivery' }),
      lostItem({ itemId: 'i-salt' }),
    ]);
    await start(user);
    expect(pickups.recordPickup).toHaveBeenCalledOnce();
  });

  it('still opens the route if recording fails', async () => {
    const pickups = fakePickups({
      recordPickup: vi.fn(async () => {
        throw new Error('offline');
      }),
    });
    const { user } = withPickups([planItem()], pickups);
    await start(user);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('link', { name: 'Start route' }).getAttribute('href')).toMatch(/maps/);
  });
});

describe('quantity hints', () => {
  it('shows what the shop said about how much it has', () => {
    show(
      planWithItems([
        planItem({ itemId: 'i-tea', status: 'likely', quantityHint: 'few' }),
        planItem({ itemId: 'i-sugar', shopId: 's2', status: 'likely', quantityHint: 'plenty' }),
      ]),
    );
    expect(screen.getByText('Only a few left')).toBeTruthy();
    expect(screen.getByText('Plenty')).toBeTruthy();
  });
});
