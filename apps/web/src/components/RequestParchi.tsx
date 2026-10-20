import { useT } from '../i18n/index.js';
import { itemLabel } from '../lib/results.js';
import type { SeekerRequest } from '../lib/seekerApi.js';
import { Parchi } from '../ui/Parchi.js';
import '../customer/replies.css';

/** "0.5", "2": a distance in km without a trailing zero. */
const kilometres = (metres: number) => String(Math.round(metres / 100) / 10);

/**
 * The customer's own request as a paper slip: how many shops it went to, the item in
 * handwriting, and a stamp once a shop has said yes. The only paper in the customer app.
 */
export function RequestParchi({ request }: { request: SeekerRequest }) {
  const { t, lang } = useT();
  const haveIt = request.results.filter((r) => r.source === 'live').length;
  return (
    <Parchi delivery={request.wantsDelivery === true} className="cu-parchi">
      <div className="sh-parchi__meta">
        <span className="sh-caption sh-paper-muted cu-parchi__meta">
          {t.c.sentTo(request.pingStats.sent, kilometres(request.radiusM))}
        </span>
        {haveIt > 0 && <span className="sh-stamp sh-stamp--yes">{t.c.haveIt(haveIt)}</span>}
      </div>
      <div className="sh-parchi__ruled">
        <h2 className="sh-parchi__item">{itemLabel(request.item, lang) ?? t.c.itemFallback}</h2>
      </div>
    </Parchi>
  );
}
