import { useRef, type ReactNode } from 'react';
import { useT } from '../../i18n/index.js';
import { Icon } from './Icon.js';
import { useFocusTrap } from './useFocusTrap.js';

interface Props {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Sticks to the bottom of the sheet: the one primary button. */
  footer?: ReactNode;
}

/** A sheet that rises from the bottom: focus stays inside, Esc and the close button leave. */
export function BottomSheet({ open, ...rest }: Props) {
  return open ? <Sheet {...rest} /> : null;
}

function Sheet({ title, onClose, children, footer }: Omit<Props, 'open'>) {
  const { t } = useT();
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, onClose);
  return (
    <div className="sh-sheet-layer">
      <div className="sh-scrim" onClick={onClose} aria-hidden="true" />
      <div
        ref={ref}
        className="sh-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <div className="sh-sheet__grab" aria-hidden="true" />
        <div className="sh-sheet__head">
          <h2 className="sh-heading">{title}</h2>
          <button type="button" className="sh-icon-btn" aria-label={t.shop.close} onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        <div className="sh-sheet__body">{children}</div>
        {footer && <div className="sh-sheet__foot">{footer}</div>}
      </div>
    </div>
  );
}
