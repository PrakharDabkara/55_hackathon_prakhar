import { useEffect, useState } from 'react';
import { useT } from '../i18n/index.js';
import { Icon } from './Icon.js';

/** "+91 98••• ••210" with every digit after +91 hidden: "+91 ••••• •••••". */
const hide = (masked: string) =>
  masked.replace(/^(\+91 )(.*)$/, (_, cc, rest) => cc + rest.replace(/\d/g, '•'));

/**
 * The person's own phone, shut behind an eye button so a glance over the shoulder shows nothing.
 * Pressing the eye asks the server for the whole number (ADR-0068); it is kept in this component
 * only while it is shown. Hiding it, leaving the screen or sending the page to the background drops
 * it, and the next press asks again.
 */
export function PhoneReveal({
  masked,
  reveal,
  className,
}: {
  masked: string;
  reveal: () => Promise<string>;
  className?: string;
}) {
  const { t } = useT();
  const [full, setFull] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (full === null) return;
    const away = () => {
      if (document.visibilityState === 'hidden') setFull(null);
    };
    document.addEventListener('visibilitychange', away);
    return () => document.removeEventListener('visibilitychange', away);
  }, [full]);

  async function toggle() {
    if (full !== null) {
      setFull(null);
      return;
    }
    setBusy(true);
    setFailed(false);
    try {
      const value = await reveal();
      // An answer that lands after the page went to the background is not kept.
      setFull(document.visibilityState === 'hidden' ? null : value);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  const shown = full !== null;
  return (
    <>
      <span className="km-phone">
        <span className={className} data-testid="phone-value">
          {shown ? full : hide(masked)}
        </span>
        <button
          type="button"
          className="sh-icon-btn"
          aria-label={shown ? t.auth.hidePhone : t.auth.showPhone}
          aria-pressed={shown}
          disabled={busy}
          onClick={() => void toggle()}
        >
          <Icon name={shown ? 'eyeOff' : 'eye'} />
        </button>
      </span>
      {failed && (
        <p className="sh-alert" role="alert">
          {t.auth.revealFailed}
        </p>
      )}
    </>
  );
}
