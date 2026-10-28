import { useState, useSyncExternalStore } from 'react';
import { BRAND_NAME } from '../brand.js';
import { BUYER_PATH, SHOP_PATH, openPhoneWindows } from '../lib/phoneWindows.js';
import { Button } from '../ui/Button.js';
import './DesktopNotice.css';

const WIDE = '(min-width: 1024px)';
const KEY = 'km-desktop-notice';

// Both apps are phone-first; a laptop-wide window gets this one-line hint (not translated: it is
// for people trying the app on a laptop). The shop app never shows the brand name (CLAUDE.md).
const HINT =
  "is made for phones. For the best experience, open it on your phone, or use your browser's device mode (Chrome: F12, then Ctrl+Shift+M).";
const TIP = 'Tip: open the shop app in an incognito window, side by side, to watch a request live.';

function subscribe(onChange: () => void) {
  const query = window.matchMedia(WIDE);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}
const isWide = () => window.matchMedia(WIDE).matches;

// Storage can throw (private windows, blocked site data); the notice then lasts for this visit.
function wasDismissed(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}
function remember() {
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    // Not saved; it shows again next visit.
  }
}

/** The shop app and the customer app keep separate login tokens, so two windows never log each other out. */
export function DesktopNotice({ app }: { app: 'buyer' | 'shop' }) {
  const wide = useSyncExternalStore(subscribe, isWide, () => false);
  const [dismissed, setDismissed] = useState(wasDismissed);
  const [blocked, setBlocked] = useState(false);
  if (!wide || dismissed) return null;

  const run = (targets: [string, string][]) => setBlocked(!openPhoneWindows(targets));
  const origin = window.location.origin;

  return (
    <aside className="dn" aria-label="Use it on a phone">
      <p className="dn__text">
        {app === 'shop' ? 'This app' : BRAND_NAME} {HINT}
      </p>
      <div className="dn__actions">
        <Button onClick={() => run([[window.location.href, `askbuy-${app}`]])}>
          Open as a phone
        </Button>
        <Button
          onClick={() =>
            run([
              [origin + BUYER_PATH, 'askbuy-buyer'],
              [origin + SHOP_PATH, 'askbuy-shop'],
            ])
          }
        >
          Open buyer + shop side by side
        </Button>
        <Button
          variant="quiet"
          onClick={() => {
            remember();
            setDismissed(true);
          }}
        >
          Dismiss
        </Button>
      </div>
      {blocked && (
        <p className="dn__tip" role="status">
          {TIP}
        </p>
      )}
    </aside>
  );
}
