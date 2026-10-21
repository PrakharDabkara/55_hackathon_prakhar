import { LIST_MAX_LINES } from '@askbuy/shared';
import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { useT } from '../i18n/index.js';
import { splitItems } from '../lib/lists.js';
import { Icon } from '../ui/Icon.js';
import '../customer/lists.css';

interface Props {
  /** One entry per line on screen. The last is the empty "Next item" line while there is room. */
  rows: string[];
  onChange: (rows: string[]) => void;
}

/** The words of the lines: trimmed, with the empty ones left out. */
export const lineTexts = (rows: readonly string[]): string[] =>
  rows.map((r) => r.trim()).filter((r) => r !== '');

/** Keeps exactly one empty line at the end while there is room, and never more than the limit. */
function tidy(
  rows: string[],
  ids: number[],
  nextId: () => number,
): { rows: string[]; ids: number[] } {
  const out = [...rows];
  const outIds = [...ids];
  while (
    out.length > 1 &&
    out[out.length - 1]?.trim() === '' &&
    out[out.length - 2]?.trim() === ''
  ) {
    out.pop();
    outIds.pop();
  }
  if (out.length > LIST_MAX_LINES) {
    out.length = LIST_MAX_LINES;
    outIds.length = LIST_MAX_LINES;
  }
  if (out.length < LIST_MAX_LINES && (out.length === 0 || out[out.length - 1]?.trim() !== '')) {
    out.push('');
    outIds.push(nextId());
  }
  return { rows: out, ids: outIds };
}

/**
 * The list being typed, as lines on a paper card (the request card of a list): numbered, in
 * handwriting. Enter makes the next line, Backspace on an empty line takes it away, a paste of
 * several lines or a comma list becomes lines. At most LIST_MAX_LINES.
 */
export function ListEditor({ rows, onChange }: Props) {
  const { t } = useT();
  const c = t.c;
  const counter = useRef(0);
  const nextId = () => ++counter.current;
  // Each line keeps its own id, so the cursor stays with the words when a line above it goes.
  const [ids, setIds] = useState<number[]>(() => rows.map(nextId));
  const inputs = useRef(new Map<number, HTMLInputElement>());
  const focusId = useRef<number | null>(null);
  const [cut, setCut] = useState(false);

  // The parent changed the rows on its own (a mode switch, a draft): line the ids up again.
  const idsNow = ids.length === rows.length ? ids : rows.map((_, i) => ids[i] ?? nextId());

  useEffect(() => {
    if (focusId.current === null) return;
    inputs.current.get(focusId.current)?.focus();
    focusId.current = null;
  });

  function commit(nextRows: string[], nextIds: number[], focus?: number | null) {
    const tidy2 = tidy(nextRows, nextIds, nextId);
    setIds(tidy2.ids);
    if (focus !== undefined) focusId.current = focus;
    onChange(tidy2.rows);
  }

  const setText = (i: number, text: string) =>
    commit(
      rows.map((r, at) => (at === i ? text : r)),
      idsNow,
    );

  function remove(i: number, focusIndex: number) {
    const nextRows = rows.filter((_, at) => at !== i);
    const nextIds = idsNow.filter((_, at) => at !== i);
    // Focus goes to the line that now sits where the removed one was, or the one before it.
    const target = nextIds[Math.min(focusIndex, nextIds.length - 1)] ?? null;
    commit(nextRows, nextIds, target);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>, i: number) {
    if (event.key === 'Enter') {
      event.preventDefault();
      if ((rows[i] ?? '').trim() === '' && i === rows.length - 1) return;
      if (rows.length >= LIST_MAX_LINES) return;
      const id = nextId();
      commit(
        [...rows.slice(0, i + 1), '', ...rows.slice(i + 1)],
        [...idsNow.slice(0, i + 1), id, ...idsNow.slice(i + 1)],
        id,
      );
    } else if (event.key === 'Backspace' && (rows[i] ?? '') === '' && rows.length > 1 && i > 0) {
      event.preventDefault();
      remove(i, i - 1);
    }
  }

  function onPaste(event: ClipboardEvent<HTMLInputElement>, i: number) {
    const parts = splitItems(event.clipboardData.getData('text'));
    if (parts.length < 2) return; // one word pastes as usual
    event.preventDefault();
    const here = (rows[i] ?? '').trim() === '';
    const before = here ? rows.slice(0, i) : rows.slice(0, i + 1);
    const after = rows.slice(i + 1).filter((r) => r.trim() !== '' || false);
    const room = Math.max(0, LIST_MAX_LINES - before.length - after.length);
    const added = parts.slice(0, room);
    setCut(parts.length > room);
    const nextRows = [...before, ...added, ...after];
    commit(
      nextRows,
      nextRows.map(() => nextId()),
      null,
    );
  }

  const filled = lineTexts(rows).length;
  const lastEmpty = rows.length < LIST_MAX_LINES || (rows[rows.length - 1] ?? '').trim() === '';

  return (
    <div className="cu-leditor">
      <div className="cu-leditor__paper">
        <ol className="cu-leditor__rows" aria-label={c.listEditorLabel}>
          {rows.map((text, i) => {
            const id = idsNow[i] as number;
            const isNext = i === rows.length - 1 && text.trim() === '' && lastEmpty;
            return (
              <li key={id} className="cu-leditor__row">
                <span className="cu-leditor__num" aria-hidden="true">
                  {i + 1}.
                </span>
                <input
                  ref={(el) => {
                    if (el) inputs.current.set(id, el);
                    else inputs.current.delete(id);
                  }}
                  className="cu-leditor__input"
                  type="text"
                  enterKeyHint="next"
                  autoComplete="off"
                  maxLength={80}
                  aria-label={isNext ? c.listNextItem : c.listItemN(i + 1)}
                  placeholder={isNext ? c.listNextItem : ''}
                  value={text}
                  onChange={(event) => setText(i, event.target.value)}
                  onKeyDown={(event) => onKeyDown(event, i)}
                  onPaste={(event) => onPaste(event, i)}
                  onBlur={() => {
                    // A line left empty in the middle goes away once the cursor leaves it.
                    if (text.trim() === '' && i < rows.length - 1) remove(i, i);
                  }}
                />
                {!isNext && (
                  <button
                    type="button"
                    className="cu-leditor__remove"
                    aria-label={c.listRemove(text.trim() || c.listItemN(i + 1))}
                    onClick={() => remove(i, i)}
                  >
                    <Icon name="close" size={20} />
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      </div>
      <div className="cu-leditor__foot">
        <p className="sh-helper">{c.listEnterHint}</p>
        <p className="sh-label cu-leditor__count" role="status">
          {c.listCount(filled, LIST_MAX_LINES)}
        </p>
      </div>
      {cut && <p className="sh-helper">{c.listCut(LIST_MAX_LINES)}</p>}
    </div>
  );
}
