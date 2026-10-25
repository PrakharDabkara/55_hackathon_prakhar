import { useT } from '../../i18n/index.js';
import { Button } from '../../ui/Button.js';

/** After Not available: said once, politely, with the one way back. No modal, no countdown to read. */
export function UndoBar({ onUndo }: { onUndo: () => void }) {
  const { t } = useT();
  return (
    <div className="sh-undo" role="status" aria-label={t.shop.undoNotAvailable}>
      <span className="sh-undo__text">{t.shop.undoNotAvailable}</span>
      <Button variant="quiet" className="sh-undo__btn" onClick={onUndo}>
        {t.shop.undo}
      </Button>
    </div>
  );
}
