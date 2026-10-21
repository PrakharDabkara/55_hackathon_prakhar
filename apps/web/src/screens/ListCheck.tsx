import { formatQuantity, unitFromQuery, type Category } from '@askbuy/shared';
import { useRef, useState } from 'react';
import { ScreenBar } from '../customer/ScreenBar.js';
import { useT } from '../i18n/index.js';
import { ApiError } from '../lib/api.js';
import type { LineView, ListView } from '../lib/listApi.js';
import { lineLabel } from '../lib/lists.js';
import { placeToSearch, type Place } from '../lib/place.js';
import type { SeekerApi } from '../lib/seekerApi.js';
import { Button } from '../ui/Button.js';
import '../customer/lists.css';

interface Props {
  api: Pick<SeekerApi, 'sendList'>;
  list: ListView;
  /** Where the list is searched from: the place Find used. Missing after a reload: asked for again. */
  origin: Place | null;
  onSent: (list: ListView, origin: Place) => void;
  /** Back to the list editor on Find. */
  onEdit: () => void;
  onBack: () => void;
}

/** An answer to one question: an option's item id, or the customer's own words. */
type Choice = string | 'typed';

/**
 * Check your list: shown only when a line needs the customer (a question, or a line we cannot
 * send). Every other line is shown as understood. The customer answers each question, then asks
 * the shops. The words about the AI are always here (ADR-0055).
 */
export function ListCheck({ api, list, origin, onSent, onEdit, onBack }: Props) {
  const { t } = useT();
  const c = t.c;
  const [choices, setChoices] = useState<Record<number, Choice>>({});
  const [missing, setMissing] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sending = useRef(false);

  const sendable = list.lines.some((l) => l.status !== 'refused');

  function describe(line: LineView) {
    const own = line.item ? (line.displayName ?? lineLabel(line)) : line.text;
    const sub = [
      line.displayName && line.item ? lineLabel(line) : null,
      line.quantity
        ? formatQuantity({
            amount: line.quantity.quantity,
            unit: unitFromQuery(line.quantity.unit),
          })
        : null,
    ].filter((part): part is string => part !== null && part !== '');
    return { own, sub: sub.join(' · ') };
  }

  async function send() {
    if (sending.current || !sendable) return;
    const open = list.lines.find(
      (l) => l.status === 'ambiguous' && choices[l.position] === undefined,
    );
    if (open) {
      setMissing(open.position);
      setError(c.checkChoose(open.text));
      return;
    }
    sending.current = true;
    setBusy(true);
    setError(null);
    setMissing(null);
    try {
      const place = origin ?? (await placeToSearch());
      if (!place) {
        setError(c.checkNoPlace);
        return;
      }
      const picked = list.lines.flatMap((l) => {
        const choice = choices[l.position];
        if (l.status !== 'ambiguous' || choice === undefined) return [];
        return [
          choice === 'typed'
            ? { position: l.position, asTyped: true as const }
            : { position: l.position, itemId: choice },
        ];
      });
      const sent = await api.sendList(list.id, {
        lat: place.lat,
        lng: place.lng,
        ...(picked.length > 0 && { choices: picked }),
      });
      onSent(sent, place);
    } catch (e) {
      setError(
        e instanceof ApiError && e.code === 'list_rate_limited'
          ? c.checkRate
          : e instanceof ApiError && e.code === 'nothing_to_send'
            ? c.checkNothing
            : e instanceof ApiError && e.code === 'choice_required'
              ? c.checkChooseAll
              : c.checkGeneric,
      );
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  return (
    <>
      <ScreenBar title={c.checkTitle} onBack={onBack} />
      <main className="cu-main">
        <ul className="cu-lcheck">
          {list.lines.map((line) => {
            const group = `q-${line.position}`;
            if (line.status === 'refused')
              return (
                <li
                  key={line.position}
                  aria-label={line.text}
                  className="cu-lcheck__row cu-lcheck__row--refused"
                >
                  <p className="sh-body cu-lcheck__name">{line.text}</p>
                  <p className="cu-lcheck__sub">
                    {line.reason === 'blocked' ? c.checkBlocked : c.checkUnclear}
                  </p>
                  <Button variant="quiet" className="cu-lcheck__edit" onClick={onEdit}>
                    {c.checkEdit}
                  </Button>
                </li>
              );
            if (line.status === 'ambiguous') {
              const options = line.options ?? [];
              return (
                <li
                  key={line.position}
                  aria-label={line.text}
                  className={`cu-lcheck__row${missing === line.position ? ' cu-lcheck__row--error' : ''}`}
                >
                  <p className="sh-heading cu-lcheck__name">{line.text}</p>
                  <p id={group} className="sh-body">
                    {line.question}
                  </p>
                  <div className="cu-lchips" role="radiogroup" aria-labelledby={group}>
                    {options.map((option) => (
                      <label key={option.itemId} className="cu-lchip">
                        <input
                          type="radio"
                          name={group}
                          checked={choices[line.position] === option.itemId}
                          onChange={() =>
                            setChoices({ ...choices, [line.position]: option.itemId })
                          }
                        />
                        {option.nameEn}
                      </label>
                    ))}
                    <label className="cu-lchip">
                      <input
                        type="radio"
                        name={group}
                        checked={choices[line.position] === 'typed'}
                        onChange={() => setChoices({ ...choices, [line.position]: 'typed' })}
                      />
                      {c.checkAsTyped}
                    </label>
                  </div>
                </li>
              );
            }
            if (line.status === 'other')
              return (
                <li key={line.position} aria-label={line.text} className="cu-lcheck__row">
                  <div className="cu-lcheck__head">
                    <p className="sh-heading cu-lcheck__name">{line.text}</p>
                    <span className="cu-pill cu-pill--muted">{c.checkOther}</span>
                  </div>
                  <p className="cu-lcheck__sub">{c.checkOtherNote}</p>
                </li>
              );
            const { own, sub } = describe(line);
            return (
              <li key={line.position} aria-label={own} className="cu-lcheck__row">
                <div className="cu-lcheck__head">
                  <p className="sh-heading cu-lcheck__name">{own}</p>
                  {line.item && (
                    <span className="cu-pill">
                      {t.categories[line.item.category as Category] ?? line.item.category}
                    </span>
                  )}
                </div>
                {sub !== '' && <p className="cu-lcheck__sub">{sub}</p>}
              </li>
            );
          })}
        </ul>

        <p className="sh-helper">{c.checkAiNote}</p>
        {!sendable && <p className="sh-helper">{c.checkNothing}</p>}
        {error && (
          <p className="sh-alert" role="alert">
            {error}
          </p>
        )}
        <Button
          variant="primary"
          className="sh-btn--block"
          disabled={busy || !sendable}
          onClick={() => void send()}
        >
          {busy ? c.checkSending : c.checkSend}
        </Button>
      </main>
    </>
  );
}
