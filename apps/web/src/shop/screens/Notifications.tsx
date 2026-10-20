import { useT } from '../../i18n/index.js';
import type { PushClient } from '../../lib/push.js';
import type { PushApi } from '../../lib/pushApi.js';
import { usePush } from '../lib/hooks.js';
import { Button } from '../../ui/Button.js';
import { Icon } from '../../ui/Icon.js';

interface Props {
  api: PushApi;
  /** For tests: a stand-in for the browser's push side. */
  pushClient?: PushClient;
}

/** Notifications (ADR-0034): the browser asks for permission only when the button is tapped. */
export function Notifications({ api, pushClient }: Props) {
  const { t } = useT();
  const s = t.shop;
  const push = usePush(api, pushClient);
  return (
    <>
      <h1 className="sh-title">{s.notificationsTitle}</h1>
      <section className="sh-card sh-stack">
        <p className="sh-body">{s.notificationsBody}</p>
        {push.status === 'on' ? (
          <>
            <p className="sh-pill-note">
              <Icon name="check" size={18} />
              {s.notificationsOn}
            </p>
            <Button variant="secondary" disabled={push.busy} onClick={() => void push.disable()}>
              {s.turnOff}
            </Button>
          </>
        ) : push.status === 'blocked' ? (
          <p className="sh-helper">{s.notificationsBlocked}</p>
        ) : push.status === 'ios_install' ? (
          <p className="sh-helper">{s.notificationsIos}</p>
        ) : push.status === 'off' ? (
          <Button variant="primary" disabled={push.busy} onClick={() => void push.enable()}>
            {s.turnOnNotifications}
          </Button>
        ) : push.status === 'unsupported' || push.status === 'disabled' ? (
          <p className="sh-helper">{s.notificationsUnavailable}</p>
        ) : null}
        {push.failed && (
          <p role="alert" className="sh-error">
            {s.notificationsFailed}
          </p>
        )}
      </section>
    </>
  );
}
