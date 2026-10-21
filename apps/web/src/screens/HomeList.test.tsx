// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/api.js';
import type { SeekerApi } from '../lib/seekerApi.js';
import { fakeSeekerApi } from '../test/fakes.js';
import { draftList, openList } from '../test/fakesLists.js';
import { renderApp } from '../test/render.js';
import { Home } from './Home.js';

vi.mock('../lib/photo.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/photo.js')>()),
  shrinkPhoto: async (file: Blob) => file,
}));

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  vi.stubGlobal('navigator', {
    ...navigator,
    geolocation: {
      getCurrentPosition: (ok: (p: unknown) => void) =>
        ok({ coords: { latitude: 12.97, longitude: 77.59 } }),
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

function setup(overrides: Partial<SeekerApi> = {}, { loggedIn = true } = {}) {
  const api = fakeSeekerApi(overrides);
  const onList = vi.fn();
  const onFound = vi.fn();
  const onLoggedIn = vi.fn();
  function Harness() {
    const [on, setOn] = useState(loggedIn);
    return (
      <Home
        api={api}
        loggedIn={on}
        onLoggedIn={(token) => {
          onLoggedIn(token);
          setOn(true);
        }}
        navigate={vi.fn()}
        onFound={onFound}
        onList={onList}
      />
    );
  }
  const utils = renderApp(<Harness />, 'en');
  return { api, onList, onFound, onLoggedIn, ...utils };
}

const mode = (name: string) => screen.getByRole('button', { name });

describe('One thing / A list', () => {
  it('starts on One thing, with the Find box unchanged', () => {
    setup();
    expect(mode('One thing').getAttribute('aria-pressed')).toBe('true');
    expect(mode('A list').getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByLabelText('What do you need?')).toBeTruthy();
    expect(screen.queryByText('Enter adds the next line')).toBeNull();
  });

  it('remembers the choice on this device', async () => {
    const { user, unmount } = setup();
    await user.click(mode('A list'));
    expect(localStorage.getItem('km-find-mode')).toBe('list');
    unmount();
    setup();
    expect(mode('A list').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Enter adds the next line')).toBeTruthy();
  });

  it('offers to make a list when the text looks like several things', async () => {
    const { user } = setup();
    const box = screen.getByLabelText('What do you need?');
    expect(screen.queryByRole('button', { name: 'Several things? Make it a list' })).toBeNull();
    await user.type(box, 'atta, 2 kg');
    expect(screen.queryByRole('button', { name: 'Several things? Make it a list' })).toBeNull();
    await user.clear(box);
    await user.type(box, 'atta and sugar, tea');
    await user.click(screen.getByRole('button', { name: 'Several things? Make it a list' }));
    expect(mode('A list').getAttribute('aria-pressed')).toBe('true');
    const lines = screen.getAllByRole('textbox') as HTMLInputElement[];
    expect(lines.map((l) => l.value)).toEqual(['atta', 'sugar', 'tea', '']);
  });

  it('keeps the words when switching modes and back', async () => {
    const { user } = setup();
    await user.type(screen.getByLabelText('What do you need?'), 'javitri');
    await user.click(mode('A list'));
    await user.type(screen.getByRole('textbox', { name: 'Next item' }), 'atta{Enter}rice');
    await user.click(mode('One thing'));
    expect((screen.getByLabelText('What do you need?') as HTMLInputElement).value).toBe('javitri');
    await user.click(mode('A list'));
    expect((screen.getAllByRole('textbox') as HTMLInputElement[]).map((l) => l.value)).toEqual([
      'atta',
      'rice',
      '',
    ]);
  });

  it('writes the lines of a list into the editor again after Home is opened afresh', async () => {
    const { user, unmount } = setup();
    await user.click(mode('A list'));
    await user.type(screen.getByRole('textbox', { name: 'Next item' }), 'atta');
    unmount();
    setup();
    expect((screen.getAllByRole('textbox') as HTMLInputElement[]).map((l) => l.value)).toEqual([
      'atta',
      '',
    ]);
  });
});

describe('Find a list', () => {
  async function typeList(user: ReturnType<typeof setup>['user'], ...lines: string[]) {
    await user.click(mode('A list'));
    await user.type(screen.getByRole('textbox', { name: 'Next item' }), lines.join('{Enter}'));
  }

  it('shows the note about pick up or delivery, and no delivery switch', async () => {
    const { user } = setup();
    await user.click(mode('A list'));
    expect(
      screen.getByText('Pick up or delivery: you choose for each shop once they answer.'),
    ).toBeTruthy();
    expect(screen.queryByRole('switch', { name: 'Deliver to me' })).toBeNull();
  });

  it('disables the button with no lines and counts the lines on it', async () => {
    const { user } = setup();
    await user.click(mode('A list'));
    expect(
      (screen.getByRole('button', { name: 'Find these nearby' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await user.type(
      screen.getByRole('textbox', { name: 'Next item' }),
      'atta{Enter}rice{Enter}dal',
    );
    expect(
      (screen.getByRole('button', { name: 'Find these 3 nearby' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('sorts the list and sends it straight away when nothing needs a question', async () => {
    const sorted = draftList({ lines: [draftList().lines[0]!, draftList().lines[2]!] });
    const sent = openList();
    const { user, api, onList } = setup({
      sortList: vi.fn(async () => sorted),
      sendList: vi.fn(async () => sent),
    });
    await typeList(user, 'chini', 'tractor spare bolt');
    await user.click(screen.getByRole('button', { name: 'Find these 2 nearby' }));
    await waitFor(() => expect(onList).toHaveBeenCalled());
    expect(api.sortList).toHaveBeenCalledWith(['chini', 'tractor spare bolt']);
    expect(api.sendList).toHaveBeenCalledWith('list-draft', { lat: 12.97, lng: 77.59 });
    expect(onList).toHaveBeenCalledWith(sent, { lat: 12.97, lng: 77.59 });
  });

  it('goes to the check screen instead when a line is a question or refused', async () => {
    const sorted = draftList();
    const { user, api, onList } = setup({ sortList: vi.fn(async () => sorted) });
    await typeList(user, 'chini', 'mirchi');
    await user.click(screen.getByRole('button', { name: 'Find these 2 nearby' }));
    await waitFor(() => expect(onList).toHaveBeenCalledWith(sorted, { lat: 12.97, lng: 77.59 }));
    expect(api.sendList).not.toHaveBeenCalled();
  });

  it('asks for a login first, then sorts by itself', async () => {
    const { user, api, onList } = setup(
      {
        sortList: vi.fn(async () => draftList({ lines: [draftList().lines[0]!] })),
        sendList: vi.fn(async () => openList()),
      },
      { loggedIn: false },
    );
    await typeList(user, 'chini');
    await user.click(screen.getByRole('button', { name: 'Find 1 item nearby' }));
    const dialog = await screen.findByRole('dialog', { name: 'Log in to send your request' });
    await user.type(within(dialog).getByLabelText('Mobile number'), '9876543210');
    await user.click(within(dialog).getByRole('button', { name: 'Send code' }));
    await user.click(await within(dialog).findByRole('button', { name: 'Fill demo OTP' }));
    await user.click(within(dialog).getByRole('button', { name: 'Log in' }));
    await waitFor(() => expect(onList).toHaveBeenCalled());
    expect(api.sortList).toHaveBeenCalledTimes(1);
  });

  it('says what went wrong in plain words', async () => {
    const { user } = setup({
      sortList: vi.fn(async () => {
        throw new ApiError(400, 'line_too_long', 'x');
      }),
    });
    await typeList(user, 'atta');
    await user.click(screen.getByRole('button', { name: 'Find 1 item nearby' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Keep each item under 80 characters.',
    );
  });

  it('does not send a list twice on a double tap', async () => {
    const { user, api } = setup({ sortList: vi.fn(() => new Promise<never>(() => undefined)) });
    await typeList(user, 'atta');
    await user.dblClick(screen.getByRole('button', { name: 'Find 1 item nearby' }));
    expect(api.sortList).toHaveBeenCalledTimes(1);
  });
});
