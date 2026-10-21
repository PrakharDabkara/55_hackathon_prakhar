import { useT } from '../i18n/index.js';
import { BottomSheet } from '../ui/BottomSheet.js';
import '../customer/orders.css';
import { Button } from '../ui/Button.js';

interface Props {
  open: boolean;
  /** Says what stopping does for this kind of search. */
  body: string;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onClose: () => void;
}

/** "Stop asking shops?": the in-page question before a search or a list is closed (no browser dialog). */
export function StopAskingSheet({ open, body, busy, error, onConfirm, onClose }: Props) {
  const { t } = useT();
  return (
    <BottomSheet
      open={open}
      title={t.c.stopTitle}
      onClose={onClose}
      footer={
        <div className="cu-sheet-foot">
          <Button variant="danger" disabled={busy} onClick={onConfirm}>
            {t.c.stopConfirm}
          </Button>
          <Button variant="quiet" onClick={onClose}>
            {t.c.stopKeep}
          </Button>
        </div>
      }
    >
      <div className="cu-sheet-form">
        <p className="sh-body">{body}</p>
        {error && (
          <p className="sh-alert" role="alert">
            {error}
          </p>
        )}
      </div>
    </BottomSheet>
  );
}
