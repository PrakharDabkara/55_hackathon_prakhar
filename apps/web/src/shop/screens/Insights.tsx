import { useState } from 'react';
import { useT } from '../../i18n/index.js';
import type { ShopApi, ShopDemand } from '../../lib/api.js';
import { formatDuration } from '../lib/format.js';
import { useDemand } from '../lib/hooks.js';
import { Button } from '../ui/Button.js';
import { SegmentedControl } from '../ui/SegmentedControl.js';
import { Skeleton } from '../ui/Skeleton.js';

type Item = ShopDemand['asked'][number]['item'];

/** Insights: what came in and what the shop did with it. Only numbers the server backs. */
export function Insights({ api }: { api: Pick<ShopApi, 'shopDemand'> }) {
  const { t, lang } = useT();
  const s = t.shop;
  const [days, setDays] = useState<1 | 7>(1);
  const { demand, failed, reload } = useDemand(api, days);
  const name = (item: Item) => (lang === 'hi' ? item.nameHi : item.nameEn);

  const biggest = Math.max(1, ...(demand?.nearby.map((row) => row.customers) ?? [1]));

  return (
    <>
      <h1 className="sh-title">{s.insightsTitle}</h1>
      <SegmentedControl
        label={s.insightsTitle}
        value={String(days) as '1' | '7'}
        options={[
          { value: '1', label: s.rangeToday },
          { value: '7', label: s.range7 },
        ]}
        onChange={(value) => setDays(value === '7' ? 7 : 1)}
      />
      {demand === null && failed ? (
        <div className="sh-center">
          <p className="sh-alert" role="alert">
            {s.loadFailed}
          </p>
          <Button variant="secondary" onClick={() => void reload()}>
            {s.retry}
          </Button>
        </div>
      ) : demand === null ? (
        <div className="sh-stack" aria-busy="true">
          <span className="sh-visually-hidden">{s.loading}</span>
          <div className="sh-tiles">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} height="88px" radius="12px" />
            ))}
          </div>
          <Skeleton height="160px" radius="12px" />
        </div>
      ) : (
        <>
          <div className="sh-tiles">
            <div className="sh-tile">
              <span className="sh-figure">{demand.today.received}</span>
              <span className="sh-tile__label">{s.tileRequests}</span>
            </div>
            <div className="sh-tile">
              <span className="sh-figure">{demand.today.answered}</span>
              <span className="sh-tile__label">{s.tileAnswered}</span>
            </div>
            <div className="sh-tile">
              <span className="sh-figure sh-figure--brand">{demand.today.yes}</span>
              <span className="sh-tile__label">{s.tileInStock}</span>
            </div>
            <div className="sh-tile">
              <span className="sh-figure">{formatDuration(demand.avgReplySeconds)}</span>
              <span className="sh-tile__label">{s.tileReply}</span>
            </div>
          </div>

          <section className="sh-card sh-stack" aria-labelledby="nearby-title">
            <h2 id="nearby-title" className="sh-heading">
              {s.mostAsked}
            </h2>
            {demand.nearby.length === 0 ? (
              <p className="sh-body sh-muted">{s.noNearby}</p>
            ) : (
              <ul className="sh-bars" aria-label={s.mostAsked}>
                {demand.nearby.map((row) => (
                  <li key={row.item.nameEn} className="sh-bar">
                    <span className="sh-bar__row">
                      <span className="sh-body">{name(row.item)}</span>
                      <span className="sh-label">{row.customers}</span>
                    </span>
                    <span className="sh-bar__track" aria-hidden="true">
                      <span
                        className="sh-bar__fill"
                        style={{ width: `${Math.round((row.customers / biggest) * 100)}%` }}
                      />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="sh-card sh-stack" aria-labelledby="asked-title">
            <h2 id="asked-title" className="sh-heading">
              {s.saidNoTo}
            </h2>
            {demand.asked.length === 0 ? (
              <p className="sh-body sh-muted">{s.noItems}</p>
            ) : (
              <ul className="sh-rows" aria-label={s.saidNoTo}>
                {demand.asked.map((row) => (
                  <li key={row.item.nameEn} className="sh-row">
                    <span className="sh-body">{name(row.item)}</span>
                    <span className="sh-label">{row.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </>
  );
}
