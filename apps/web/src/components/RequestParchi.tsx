import { formatQuantity, unitFromQuery } from '@askbuy/shared';
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
  // The customer's own words lead, exactly as typed; the item they matched is small underneath
  // when it is not simply the same words (ADR-0047).
  const own = request.typed?.trim() || null;
  const item = itemLabel(request.item, lang);
  // An item the customer chose from a question is the request: their words are small underneath.
  const chosen = request.picked === true && item !== null;
  const heading = chosen ? item : (own ?? item ?? t.c.itemFallback);
  const differs = own && item && own.toLowerCase() !== item.toLowerCase();
  const matched = chosen ? (differs ? t.c.youTyped(own) : null) : differs ? item : null;
  const quantity = request.quantity
    ? formatQuantity({
        amount: request.quantity.quantity,
        unit: unitFromQuery(request.quantity.unit),
      })
    : null;
  return (
    <Parchi delivery={request.wantsDelivery === true} className="cu-parchi">
      <div className="sh-parchi__meta">
        <span className="sh-caption sh-paper-muted cu-parchi__meta">
          {request.asking === true
            ? t.c.withinKm(kilometres(request.radiusM))
            : request.pingStats.sent === 0
              ? t.c.sentToNone(kilometres(request.radiusM))
              : t.c.sentTo(request.pingStats.sent, kilometres(request.radiusM))}
        </span>
        {haveIt > 0 && <span className="sh-stamp sh-stamp--yes">{t.c.haveIt(haveIt)}</span>}
      </div>
      <div className="sh-parchi__ruled">
        <h2 className="sh-parchi__item">{heading}</h2>
        {matched && <p className="sh-parchi__alias">{matched}</p>}
        {quantity && <p className="sh-parchi__note">{quantity}</p>}
      </div>
    </Parchi>
  );
}
