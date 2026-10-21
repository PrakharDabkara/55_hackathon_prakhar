// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { at, shopOrder } from '../../test/fakes.js';
import { renderApp } from '../../test/render.js';
import { PackingSlip } from './PackingSlip.js';

const lines = [
  { name: 'sugar', count: 2, pricePaise: 4500, packed: true },
  { name: 'ball pen', count: 1, pricePaise: 1200, packed: false },
  { name: 'tractor bolt', count: 1, pricePaise: null, packed: false },
];
const order = shopOrder({
  id: 'o1',
  state: 'ACCEPTED',
  lines,
  itemsTotalPaise: 10_200,
  feePaise: 2000,
});

describe('PackingSlip', () => {
  it('says "Tick as you pack" and how many are done', () => {
    renderApp(<PackingSlip order={order} onPack={vi.fn()} />, 'en');
    expect(screen.getByText('Tick as you pack')).toBeTruthy();
    expect(screen.getByText('1 of 3 packed')).toBeTruthy();
  });

  it('a full-width checkbox row per line: name, count and price; packed ones are ticked', () => {
    renderApp(<PackingSlip order={order} onPack={vi.fn()} />, 'en');
    const rows = screen.getAllByRole('checkbox');
    expect(rows.map((r) => r.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);
    expect(at(rows, 0).textContent).toContain('Sugar');
    expect(at(rows, 0).textContent).toContain('₹90');
    expect(at(rows, 2).textContent).toContain('Price not set');
    expect(at(rows, 0).className).toContain('is-packed');
  });

  it('tapping a row asks to flip it, by its position', async () => {
    const onPack = vi.fn();
    const { user } = renderApp(<PackingSlip order={order} onPack={onPack} />, 'en');
    await user.click(at(screen.getAllByRole('checkbox'), 1));
    expect(onPack).toHaveBeenCalledWith(1, true);
    await user.click(at(screen.getAllByRole('checkbox'), 0));
    expect(onPack).toHaveBeenCalledWith(0, false);
  });

  it('shows the total with the fee and "collect cash"', () => {
    renderApp(<PackingSlip order={order} onPack={vi.fn()} />, 'en');
    expect(screen.getByText('₹122 incl. ₹20 delivery · collect cash')).toBeTruthy();
  });

  it('a finished order is a plain list: no ticking', () => {
    renderApp(
      <PackingSlip order={{ ...order, state: 'DELIVERED', final: true }} onPack={vi.fn()} />,
      'en',
    );
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });
});
