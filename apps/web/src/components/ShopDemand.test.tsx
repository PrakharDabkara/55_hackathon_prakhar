// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ShopDemand as Demand } from '../lib/api.js';
import { fakeApi } from '../test/fakes.js';
import { renderApp } from '../test/render.js';
import { ShopDemand } from './ShopDemand.js';

const demand = (over: Partial<Demand> = {}): Demand => ({
  today: { received: 7, answered: 5, yes: 3 },
  asked: [
    { item: { nameEn: 'cumin', nameHi: 'जीरा' }, count: 4 },
    { item: { nameEn: 'ghee', nameHi: 'घी' }, count: 1 },
  ],
  nearby: [{ item: { nameEn: 'candles', nameHi: 'मोमबत्ती' }, customers: 5 }],
  ...over,
});
const setup = (value: Demand | Error, lang: 'hi' | 'en' = 'hi') => {
  const api = fakeApi({
    shopDemand: vi.fn(async () => {
      if (value instanceof Error) throw value;
      return value;
    }),
  });
  return { api, ...renderApp(<ShopDemand api={api} />, lang) };
};

describe('"Aaj ki maang" card (ADR-0035)', () => {
  it('shows the three numbers of today', async () => {
    setup(demand());
    const card = await screen.findByRole('region', { name: 'Aaj ki maang' });
    expect(within(card).getByLabelText('Aaye sawaal: 7')).toBeTruthy();
    expect(within(card).getByLabelText('Jawab diye: 5')).toBeTruthy();
    expect(within(card).getByLabelText('Haan kaha: 3')).toBeTruthy();
  });

  it('lists what people asked this shop for and did not get, with counts', async () => {
    setup(demand());
    const list = await screen.findByRole('list', { name: 'Log ye pooch rahe the' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toMatch(/cumin/);
    expect(rows[0]?.textContent).toMatch(/4/);
  });

  it("lists the area's demand as a count of customers", async () => {
    setup(demand());
    const list = await screen.findByRole('list', { name: 'Aas-paas ki maang' });
    const [row] = within(list).getAllByRole('listitem');
    expect(row?.textContent).toMatch(/candles/);
    expect(row?.textContent).toMatch(/5 grahak/);
  });

  it('names an item without a Devanagari name once ("Kesar Kesar" before)', async () => {
    setup(
      demand({
        asked: [
          { item: { nameEn: 'Kesar', nameHi: 'Kesar' }, count: 2 },
          { item: { nameEn: 'saffron pouch', nameHi: 'Saffron Pouch' }, count: 1 },
        ],
      }),
    );
    const list = await screen.findByRole('list', { name: 'Log ye pooch rahe the' });
    const [kesar, pouch] = within(list).getAllByRole('listitem');
    expect(kesar?.textContent).toMatch(/Kesar/);
    expect(kesar?.textContent?.match(/Kesar/g)).toHaveLength(1);
    expect(pouch?.textContent?.match(/saffron pouch/gi)).toHaveLength(1);
  });

  it('still shows the Hindi name first when there is one', async () => {
    setup(demand());
    const list = await screen.findByRole('list', { name: 'Log ye pooch rahe the' });
    const [cumin] = within(list).getAllByRole('listitem');
    expect(cumin?.textContent).toMatch(/जीरा.*cumin/);
  });

  it('says so, rather than showing an empty list, on a quiet day', async () => {
    setup(demand({ today: { received: 0, answered: 0, yes: 0 }, asked: [], nearby: [] }));
    const card = await screen.findByRole('region', { name: 'Aaj ki maang' });
    expect(within(card).queryAllByRole('listitem')).toHaveLength(0);
    expect(within(card).getAllByText(/Abhi koi nahi|Aaj koi nahi/).length).toBeGreaterThan(0);
  });

  it('draws nothing at all if it cannot be fetched: the questions never wait for it', async () => {
    const { api } = setup(new Error('offline'));
    await waitFor(() => expect(api.shopDemand).toHaveBeenCalled());
    expect(screen.queryByRole('region')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('speaks English when asked to', async () => {
    setup(demand(), 'en');
    const card = await screen.findByRole('region', { name: "Today's demand" });
    expect(within(card).getByLabelText('Questions received: 7')).toBeTruthy();
    expect(within(card).getByText(/5 customers/)).toBeTruthy();
  });
});
