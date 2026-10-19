import { useState } from 'react';
import { useT } from '../../i18n/index.js';
import { Icon } from './Icon.js';
import { ShopLogo } from './ShopLogo.js';
import { useToast } from './Toast.js';

interface Props {
  name: string;
  logoUrl: string | null;
  open: boolean;
  onMenu: () => void;
  /** Resolves when the server has the new state; rejects when it could not be saved. */
  onToggleOpen: (open: boolean) => Promise<void>;
}

/** Sticky, 64 px: menu, logo, name, and the Open / Closed switch with a toast that says what changed. */
export function ShopHeader({ name, logoUrl, open, onMenu, onToggleOpen }: Props) {
  const { t } = useT();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function toggle() {
    const next = !open;
    setBusy(true);
    try {
      await onToggleOpen(next);
      toast(next ? t.shop.toastOpen : t.shop.toastClosed);
    } catch {
      toast(t.shop.openFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <header className="sh-header">
      <button type="button" className="sh-icon-btn" aria-label={t.shop.menu} onClick={onMenu}>
        <Icon name="menu" />
      </button>
      <ShopLogo name={name} logoUrl={logoUrl} size={40} />
      <span className="sh-header__name">{name}</span>
      <button
        type="button"
        role="switch"
        aria-checked={open}
        disabled={busy}
        className={`sh-pill ${open ? 'sh-pill--open' : 'sh-pill--closed'}`}
        onClick={() => void toggle()}
      >
        <span className="sh-pill__label">{open ? t.shop.open : t.shop.closed}</span>
        <span className="sh-pill__knob" aria-hidden="true" />
      </button>
    </header>
  );
}
