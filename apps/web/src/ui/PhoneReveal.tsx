import { useState } from 'react';
import { useT } from '../i18n/index.js';
import { Icon } from './Icon.js';

/** "+91 98••• ••210" with every digit after +91 hidden: "+91 ••••• •••••". */
const hide = (masked: string) =>
  masked.replace(/^(\+91 )(.*)$/, (_, cc, rest) => cc + rest.replace(/\d/g, '•'));

/**
 * The person's own phone, as the server partly hides it (ADR-0054), shut behind an eye button so a
 * glance over the shoulder shows nothing. Pressing it shows that same partly hidden number.
 */
export function PhoneReveal({ masked, className }: { masked: string; className?: string }) {
  const { t } = useT();
  const [shown, setShown] = useState(false);
  return (
    <span className="km-phone">
      <span className={className} data-testid="phone-value">
        {shown ? masked : hide(masked)}
      </span>
      <button
        type="button"
        className="sh-icon-btn"
        aria-label={shown ? t.auth.hidePhone : t.auth.showPhone}
        aria-pressed={shown}
        onClick={() => setShown((value) => !value)}
      >
        <Icon name={shown ? 'eyeOff' : 'eye'} />
      </button>
    </span>
  );
}
