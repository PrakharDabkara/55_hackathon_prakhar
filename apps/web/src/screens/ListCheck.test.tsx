// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/api.js';
import type { SeekerApi } from '../lib/seekerApi.js';
import { fakeSeekerApi } from '../test/fakes.js';
import { draftList, itemLine } from '../test/fakesLists.js';
import { renderApp } from '../test/render.js';
import { ListCheck } from './ListCheck.js';

beforeEach(() => sessionStorage.clear());

const ORIGIN = { lat: 22.7196, lng: 75.8577 };

function show(overrides: Partial<SeekerApi> = {}, list = draftList()) {
  const api = fakeSeekerApi(overrides);
  const onSent = vi.fn();
  const onEdit = vi.fn();
  const utils = renderApp(
    <ListCheck
      api={api}
      list={list}
      origin={ORIGIN}
      onSent={onSent}
      onEdit={onEdit}
      onBack={onEdit}
    />,
    'en',
  );
  return { api, onSent, onEdit, ...utils };
}

describe('Check your list', () => {
  it('shows a clear item with the word used, the catalog name and quantity, and a category chip', () => {
    show();
    const row = screen.getByRole('listitem', { name: 'Chini' });
    expect(within(row).getByText('Chini')).toBeTruthy();
    expect(within(row).getByText('Sugar · 2 kg')).toBeTruthy();
    expect(within(row).getByText('Grocery')).toBeTruthy();
  });

  it('asks the question of an ambiguous line, with radio chips and "As I typed"', () => {
    show();
    const row = screen.getByRole('listitem', { name: 'mirchi' });
    expect(within(row).getByText('Which mirchi?')).toBeTruthy();
    const group = within(row).getByRole('radiogroup', { name: 'Which mirchi?' });
    expect(within(group).getByRole('radio', { name: 'Green chilli' })).toBeTruthy();
    expect(within(group).getByRole('radio', { name: 'Red chilli powder' })).toBeTruthy();
    expect(within(group).getByRole('radio', { name: 'As I typed' })).toBeTruthy();
  });

  it('marks an "other" line as asked of every shop nearby', () => {
    show();
    const row = screen.getByRole('listitem', { name: 'tractor spare bolt' });
    expect(within(row).getByText("Not in our list: we'll ask every shop nearby")).toBeTruthy();
    expect(within(row).getByText('Other')).toBeTruthy();
  });

  it('mutes a refused line and says why, with a way back to edit', async () => {
    const { user, onEdit } = show();
    const blocked = screen.getByRole('listitem', { name: 'a gun' });
    expect(within(blocked).getByText("We can't ask shops for this")).toBeTruthy();
    const unclear = screen.getByRole('listitem', { name: 'something nice' });
    expect(within(unclear).getByText('Not clear enough: edit it')).toBeTruthy();
    await user.click(within(unclear).getByRole('button', { name: 'Edit list' }));
    expect(onEdit).toHaveBeenCalled();
  });

  it('shows the AI note', () => {
    show();
    expect(
      screen.getByText(
        'AI sorted your list and can make mistakes. Shops see only the items they sell, plus any Other items. Never your name or number.',
      ),
    ).toBeTruthy();
  });

  it('will not send until every question is answered', async () => {
    const { user, api } = show();
    const send = screen.getByRole('button', { name: 'Ask shops nearby' });
    await user.click(send);
    expect(api.sendList).not.toHaveBeenCalled();
    expect(screen.getByText('Choose one for “mirchi”.')).toBeTruthy();
  });

  it('sends the choices with the same place as Find', async () => {
    const sent = { ...draftList(), state: 'OPEN' as const };
    const sendList = vi.fn(async () => sent);
    const { user, onSent } = show({ sendList });
    const row = screen.getByRole('listitem', { name: 'mirchi' });
    await user.click(within(row).getByRole('radio', { name: 'Red chilli powder' }));
    await user.click(screen.getByRole('button', { name: 'Ask shops nearby' }));
    await waitFor(() => expect(sendList).toHaveBeenCalledTimes(1));
    expect(sendList).toHaveBeenCalledWith('list-draft', {
      lat: 22.7196,
      lng: 75.8577,
      choices: [{ position: 1, itemId: 'item-red' }],
    });
    expect(onSent).toHaveBeenCalledWith(sent, ORIGIN);
  });

  it('sends "As I typed" as asTyped', async () => {
    const { user, api } = show();
    const row = screen.getByRole('listitem', { name: 'mirchi' });
    await user.click(within(row).getByRole('radio', { name: 'As I typed' }));
    await user.click(screen.getByRole('button', { name: 'Ask shops nearby' }));
    await waitFor(() => expect(api.sendList).toHaveBeenCalled());
    expect((api.sendList as ReturnType<typeof vi.fn>).mock.calls[0]![1].choices).toEqual([
      { position: 1, asTyped: true },
    ]);
  });

  it('cannot send when every line is refused', () => {
    const list = draftList({ lines: [draftList().lines[3]!] });
    show({}, list);
    expect(
      (screen.getByRole('button', { name: 'Ask shops nearby' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByText('Nothing here can be sent. Edit your list.')).toBeTruthy();
  });

  it.each([
    [429, 'list_rate_limited', "You've sent several lists this hour. Try again a bit later."],
    [422, 'nothing_to_send', 'Nothing here can be sent. Edit your list.'],
    [400, 'choice_required', 'Choose one for each question first.'],
    [500, 'internal', "Couldn't send your list. Check your connection and try again."],
  ])('maps %s %s to friendly words', async (status, code, message) => {
    const { user } = show(
      {
        sendList: vi.fn(async () => {
          throw new ApiError(status, code, 'x');
        }),
      },
      draftList({ lines: [itemLine(0, 'atta'), draftList().lines[3]!] }),
    );
    await user.click(screen.getByRole('button', { name: 'Ask shops nearby' }));
    expect((await screen.findByRole('alert')).textContent).toBe(message);
  });
});
