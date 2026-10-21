import { useState } from 'react';
import '../customer/find.css';
import { useT } from '../i18n/index.js';
import { BottomSheet } from '../ui/BottomSheet.js';
import { Button } from '../ui/Button.js';
import { Field } from '../ui/Field.js';

export interface FollowUpOption {
  itemId: string;
  nameEn: string;
  nameHi: string;
}

/** What the server asked: which item (item_ambiguous), or "did you mean" (item_confirm). */
export interface FollowUp {
  /** What the server asked (item_ambiguous): shown as the title when there is one. */
  question?: string;
  /** The item the app understood, offered first (item_confirm only). */
  understood?: FollowUpOption;
  options: FollowUpOption[];
}

interface Props {
  followUp: FollowUp | null;
  busy: boolean;
  /** What the customer typed: offered first as "search exactly this". */
  typed: string;
  /** Why the last exact search failed, shown inside the sheet so the customer is not dropped. */
  error?: string | null;
  /** Search exactly the typed words (or the words written under "Something else"). */
  onAsTyped: (text: string, from: 'typed' | 'else') => void;
  onPick: (itemId: string, understanding?: 'confirmed' | 'changed') => void;
  onClose: () => void;
}

/** "Did you mean?": one big button per item, English names first, and a way to say it differently. */
export function FollowUpSheet({ followUp, busy, typed, error, onPick, onAsTyped, onClose }: Props) {
  const { t, lang } = useT();
  const c = t.c;
  const [other, setOther] = useState('');
  if (!followUp) return null;
  const { understood, options } = followUp;
  const name = (o: FollowUpOption) => (lang === 'hi' ? o.nameHi || o.nameEn : o.nameEn || o.nameHi);
  // The server's own question is data: shown as plain text, never acted on.
  const title = understood ? c.askDidYouMean(name(understood)) : followUp.question || c.askWhich;

  return (
    <BottomSheet open title={title} onClose={onClose}>
      <form
        className="cu-find__form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy && other.trim() !== '') onAsTyped(other.trim(), 'else');
        }}
      >
        <Button
          variant="secondary"
          className="cu-find__option"
          disabled={busy}
          onClick={() => onAsTyped(typed, 'typed')}
        >
          {c.askAsTyped(typed)}
        </Button>
        {understood && (
          <Button
            variant="solid"
            className="cu-find__option"
            disabled={busy}
            onClick={() => onPick(understood.itemId, 'confirmed')}
          >
            <span className="cu-find__option-hint">{c.askYes}</span>
            {name(understood)}
          </Button>
        )}
        {options.map((o) => (
          <Button
            key={o.itemId}
            variant="secondary"
            className="cu-find__option"
            disabled={busy}
            onClick={() => onPick(o.itemId, understood ? 'changed' : undefined)}
          >
            {name(o)}
          </Button>
        ))}
        <Field
          label={c.askElse}
          placeholder={c.askElseHint}
          autoComplete="off"
          value={other}
          onChange={(event) => setOther(event.target.value)}
        />
        <Button variant="quiet" type="submit" disabled={busy || other.trim() === ''}>
          {c.askElseGo}
        </Button>
        {error && (
          <p role="alert" className="sh-error">
            {error}
          </p>
        )}
      </form>
    </BottomSheet>
  );
}
