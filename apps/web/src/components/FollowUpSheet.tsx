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
  /** The item the app understood, offered first (item_confirm only). */
  understood?: FollowUpOption;
  options: FollowUpOption[];
}

interface Props {
  followUp: FollowUp | null;
  busy: boolean;
  onPick: (itemId: string, understanding?: 'confirmed' | 'changed') => void;
  /** The customer wrote it another way: search again with these words. */
  onRewrite: (text: string) => void;
  onClose: () => void;
}

/** "Did you mean?": one big button per item, English names first, and a way to say it differently. */
export function FollowUpSheet({ followUp, busy, onPick, onRewrite, onClose }: Props) {
  const { t, lang } = useT();
  const c = t.c;
  const [other, setOther] = useState('');
  if (!followUp) return null;
  const { understood, options } = followUp;
  const name = (o: FollowUpOption) => (lang === 'hi' ? o.nameHi || o.nameEn : o.nameEn || o.nameHi);
  const title = understood ? c.askDidYouMean(name(understood)) : c.askWhich;

  return (
    <BottomSheet open title={title} onClose={onClose}>
      <div className="cu-find__form">
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
        <Button
          variant="quiet"
          disabled={busy || other.trim() === ''}
          onClick={() => onRewrite(other.trim())}
        >
          {c.askElseGo}
        </Button>
      </div>
    </BottomSheet>
  );
}
