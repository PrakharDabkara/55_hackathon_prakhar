// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PlanItem } from '../lib/seekerApi.js';
import { errandPlan, fakePickups, planItem } from '../test/fakes.js';
import { renderApp } from '../test/render.js';
import { ErrandResult } from './ErrandResult.js';

vi.mock('../components/PlanMap.js', () => ({ PlanMap: () => <div /> }));

const origin = { lat: 22.7196, lng: 75.8577 };
const noNavigation = (event: Event) => event.preventDefault();

function setup(items: PlanItem[]) {
  const base = errandPlan();
  const variant = { ...base.plans.kam_dukaan, items };
  const plan = errandPlan({ plans: { ...base.plans, kam_dukaan: variant, sasta: variant } });
  const pickups = fakePickups();
  const utils = renderApp(
    <ErrandResult plan={plan} origin={origin} pickupApi={pickups} errandId="errand-7" />,
  );
  return { pickups, ...utils };
}
async function openRoute(user: ReturnType<typeof setup>['user']) {
  const link = screen.getByRole('link', { name: 'Raasta kholo' });
  link.addEventListener('click', noNavigation);
  await user.click(link);
}

describe('"Raasta kholo" on a plan records the visits (ADR-0035)', () => {
  it('records each pickup shop and item of the plan once', async () => {
    const { pickups, user } = setup([
      planItem({ itemId: 'i-tea', shopId: 's1' }),
      planItem({ itemId: 'i-sugar', shopId: 's2', status: 'likely' }),
    ]);
    await openRoute(user);
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
    const { pickups, user } = setup([
      planItem({ itemId: 'i-tea', shopId: 's1' }),
      planItem({ itemId: 'i-sugar', shopId: 's2', mode: 'delivery' }),
      planItem({ itemId: 'i-salt', shopId: null, shopName: null, status: 'not_found' }),
    ]);
    await openRoute(user);
    expect(pickups.recordPickup).toHaveBeenCalledOnce();
    expect(pickups.recordPickup).toHaveBeenCalledWith({
      shopId: 's1',
      itemId: 'i-tea',
      errandId: 'errand-7',
    });
  });

  it('still opens the route if recording fails', async () => {
    const base = errandPlan();
    const pickups = fakePickups({
      recordPickup: vi.fn(async () => {
        throw new Error('offline');
      }),
    });
    const { user } = renderApp(
      <ErrandResult plan={base} origin={origin} pickupApi={pickups} errandId="errand-7" />,
    );
    await openRoute(user);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('link', { name: 'Raasta kholo' }).getAttribute('href')).toMatch(/maps/);
  });
});

describe('"Grahak ne confirm kiya" on plan cards (PR H)', () => {
  it('shows the badge on an item whose shop a customer confirmed, and only there', () => {
    setup([
      planItem({ itemId: 'i-tea', shopId: 's1', status: 'likely', customerVerified: true }),
      planItem({ itemId: 'i-sugar', shopId: 's2', status: 'likely' }),
    ]);
    expect(screen.getAllByText('Grahak ne confirm kiya')).toHaveLength(1);
  });

  it('is in English on an English screen', () => {
    const base = errandPlan();
    const variant = {
      ...base.plans.kam_dukaan,
      items: [planItem({ status: 'likely', customerVerified: true })],
    };
    renderApp(
      <ErrandResult
        plan={errandPlan({ plans: { ...base.plans, kam_dukaan: variant, sasta: variant } })}
        origin={origin}
        pickupApi={fakePickups()}
        errandId="errand-7"
      />,
      'en',
    );
    expect(screen.getByText('Confirmed by a customer')).toBeTruthy();
  });
});

describe('quantity on plan cards (PR I, scenario S13)', () => {
  it('shows what the shop said about how much it has', () => {
    setup([
      planItem({ itemId: 'i-tea', status: 'likely', quantityHint: 'few' }),
      planItem({ itemId: 'i-sugar', shopId: 's2', status: 'likely', quantityHint: 'plenty' }),
    ]);
    expect(screen.getByText('थोड़ा बचा है')).toBeTruthy();
    expect(screen.getByText('काफ़ी है')).toBeTruthy();
  });
});
