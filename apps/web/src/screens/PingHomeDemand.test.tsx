// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { fakeApi } from '../test/fakes.js';
import { renderApp } from '../test/render.js';
import { PingHome } from './PingHome.js';

describe('the shop screen carries "Aaj ki maang" (ADR-0035)', () => {
  it('shows the card next to the questions', async () => {
    const api = fakeApi({
      shopDemand: vi.fn(async () => ({
        today: { received: 2, answered: 1, yes: 1 },
        asked: [],
        nearby: [],
      })),
    });
    renderApp(<PingHome api={api} />);
    expect(await screen.findByRole('region', { name: 'Aaj ki maang' })).toBeTruthy();
    expect(await screen.findByText(/Abhi koi sawaal nahi/)).toBeTruthy();
  });

  it('works without it: a failing card never hides the questions', async () => {
    const api = fakeApi({
      shopDemand: vi.fn(async () => {
        throw new Error('offline');
      }),
    });
    renderApp(<PingHome api={api} />);
    expect(await screen.findByText(/Abhi koi sawaal nahi/)).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Aaj ki maang' })).toBeNull();
  });
});
