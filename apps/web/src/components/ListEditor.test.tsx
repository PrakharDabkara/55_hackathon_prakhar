// @vitest-environment jsdom
import { fireEvent, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderApp } from '../test/render.js';
import { ListEditor, lineTexts } from './ListEditor.js';
import { at } from '../test/fakesLists.js';

function setup(initial: string[] = ['']) {
  const changes = vi.fn();
  function Harness() {
    const [rows, setRows] = useState(initial);
    return (
      <ListEditor
        rows={rows}
        onChange={(next) => {
          changes(next);
          setRows(next);
        }}
      />
    );
  }
  return { changes, ...renderApp(<Harness />, 'en') };
}

const inputs = () => screen.getAllByRole('textbox') as HTMLInputElement[];
const values = () => inputs().map((i) => i.value);

describe('the list editor', () => {
  it('starts with one empty "Next item" line, a count and the Enter hint', () => {
    setup();
    const next = screen.getByRole('textbox', { name: 'Next item' }) as HTMLInputElement;
    expect(next.getAttribute('enterkeyhint')).toBe('next');
    expect(next.placeholder).toBe('Next item');
    expect(screen.getByText('0 of 10')).toBeTruthy();
    expect(screen.getByText('Enter adds the next line')).toBeTruthy();
  });

  it('numbers the lines and counts the ones with words', async () => {
    const { user } = setup();
    await user.type(screen.getByRole('textbox', { name: 'Next item' }), 'atta');
    expect(values()).toEqual(['atta', '']);
    expect(screen.getByText('1 of 10')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Item 1' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Next item' })).toBeTruthy();
  });

  it('Enter makes the next line and moves the cursor there', async () => {
    const { user } = setup();
    await user.type(
      screen.getByRole('textbox', { name: 'Next item' }),
      'atta{Enter}rice{Enter}dal',
    );
    expect(values()).toEqual(['atta', 'rice', 'dal', '']);
    expect(document.activeElement).toBe(inputs()[2]);
  });

  it('Enter on the empty last line adds nothing', async () => {
    const { user } = setup();
    await user.type(screen.getByRole('textbox', { name: 'Next item' }), '{Enter}{Enter}');
    expect(values()).toEqual(['']);
  });

  it('Enter in the middle opens a line right after it', async () => {
    const { user } = setup(['atta', 'dal', '']);
    await user.click(at(inputs(), 0));
    await user.keyboard('{Enter}');
    expect(values()).toEqual(['atta', '', 'dal', '']);
    expect(document.activeElement).toBe(inputs()[1]);
  });

  it('Backspace on an empty line removes it and focuses the one before', async () => {
    const { user } = setup();
    await user.type(screen.getByRole('textbox', { name: 'Next item' }), 'atta{Enter}');
    expect(values()).toEqual(['atta', '']);
    await user.keyboard('{Backspace}');
    expect(values()).toEqual(['atta', '']);
    expect(document.activeElement).toBe(inputs()[0]);
    // Backspace on a line with words only deletes a letter.
    await user.keyboard('{Backspace}');
    expect(values()[0]).toBe('att');
  });

  it('Backspace on an empty middle line closes the gap', async () => {
    const { user } = setup(['atta', '', 'dal', '']);
    await user.click(at(inputs(), 1));
    await user.keyboard('{Backspace}');
    expect(values()).toEqual(['atta', 'dal', '']);
    expect(document.activeElement).toBe(inputs()[0]);
  });

  it('splits pasted lines and comma lists into lines', () => {
    setup();
    fireEvent.paste(screen.getByRole('textbox', { name: 'Next item' }), {
      clipboardData: { getData: () => 'atta\nrice, dal\n2. namak' },
    });
    expect(values()).toEqual(['atta', 'rice', 'dal', 'namak', '']);
    expect(screen.getByText('4 of 10')).toBeTruthy();
  });

  it('lets a single pasted word go in as usual', () => {
    setup();
    const proceeded = fireEvent.paste(screen.getByRole('textbox', { name: 'Next item' }), {
      clipboardData: { getData: () => 'atta' },
    });
    expect(proceeded).toBe(true);
  });

  it('keeps ten lines at most, hides the new line, and says what was left out', () => {
    setup();
    const twelve = Array.from({ length: 12 }, (_, i) => `item ${i + 1}`).join('\n');
    fireEvent.paste(screen.getByRole('textbox', { name: 'Next item' }), {
      clipboardData: { getData: () => twelve },
    });
    expect(values()).toHaveLength(10);
    expect(values()[9]).toBe('item 10');
    expect(screen.queryByRole('textbox', { name: 'Next item' })).toBeNull();
    expect(screen.getByText('10 of 10')).toBeTruthy();
    expect(screen.getByText('Only the first 10 were kept.')).toBeTruthy();
  });

  it('brings the new line back when one of ten is removed', async () => {
    const { user } = setup(Array.from({ length: 10 }, (_, i) => `item ${i + 1}`));
    expect(screen.queryByRole('textbox', { name: 'Next item' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Remove item 3' }));
    expect(values()).toHaveLength(10);
    expect(screen.getByRole('textbox', { name: 'Next item' })).toBeTruthy();
    expect(screen.getByText('9 of 10')).toBeTruthy();
  });

  it('removes a line with its ✕ button, named after the item', async () => {
    const { user } = setup(['atta', 'rice', '']);
    await user.click(screen.getByRole('button', { name: 'Remove atta' }));
    expect(values()).toEqual(['rice', '']);
  });

  it('has no ✕ on the empty last line', () => {
    setup(['atta', '']);
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('drops a line left empty once the cursor leaves it', async () => {
    const { user } = setup(['atta', 'dal', '']);
    await user.click(at(inputs(), 0));
    await user.keyboard('{Enter}');
    expect(values()).toEqual(['atta', '', 'dal', '']);
    await user.click(at(inputs(), 2));
    expect(values()).toEqual(['atta', 'dal', '']);
  });

  it('lineTexts gives the words of the lines, trimmed, without the empty ones', () => {
    expect(lineTexts(['  atta ', '', 'rice', ''])).toEqual(['atta', 'rice']);
  });
});
