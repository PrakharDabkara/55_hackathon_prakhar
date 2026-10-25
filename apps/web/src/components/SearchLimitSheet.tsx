import { useState } from 'react';
import { useT } from '../i18n/index.js';
import { refOf } from '../lib/errorRef.js';
import type { ActiveSearch } from '../lib/seekerApi.js';
import { BottomSheet } from '../ui/BottomSheet.js';
import { Button } from '../ui/Button.js';
import { searchLabel } from './ActiveSearchCards.js';

interface Props {
  open: boolean;
  searches: ActiveSearch[];
  limit: number;
  /** Stops one search; rejects when it could not be stopped. */
  onStop: (search: ActiveSearch) => Promise<void>;
  onClose: () => void;
}

/** The customer already has the most searches: pick one to stop (or cancel), no modal dialogs of the browser. */
export function SearchLimitSheet({ open, searches, limit, onStop, onClose }: Props) {
  const { t, lang } = useT();
  const c = t.c;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function stop(search: ActiveSearch) {
    setBusy(search.id);
    setError(null);
    try {
      await onStop(search);
    } catch (failure) {
      setError(`${c.limitStopFailed} ${c.refLine(refOf(failure))}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <BottomSheet
      open={open}
      title={c.limitTitle.replace('3', String(limit))}
      onClose={onClose}
      footer={
        <Button variant="secondary" className="sh-btn--block" onClick={onClose}>
          {c.limitCancel}
        </Button>
      }
    >
      <div className="cu-find__form">
        <p className="sh-body">{c.limitHelp}</p>
        {searches.map((s) => {
          const label = searchLabel(s, lang, c.activeList(s.kind === 'list' ? s.lineCount : 0));
          return (
            <Button
              key={`${s.kind}-${s.id}`}
              variant="secondary"
              className="cu-find__option"
              disabled={busy !== null}
              onClick={() => void stop(s)}
            >
              {c.limitStop(label)}
            </Button>
          );
        })}
        {error && (
          <p role="alert" className="sh-error">
            {error}
          </p>
        )}
      </div>
    </BottomSheet>
  );
}
