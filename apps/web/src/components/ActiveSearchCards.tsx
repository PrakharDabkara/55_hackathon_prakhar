import { appLink } from '../customer/ordersShared.js';
import { useT } from '../i18n/index.js';
import type { ActiveSearch } from '../lib/seekerApi.js';
import { Button } from '../ui/Button.js';

interface Props {
  searches: ActiveSearch[];
  limit: number;
  navigate: (path: string) => void;
  /** Offered while fewer than `limit` searches are live and Find is on one thing. */
  onMakeList?: () => void;
}

/** What a search is called on its card, in the customer's language. */
export function searchLabel(search: ActiveSearch, lang: 'en' | 'hi', listLabel: string): string {
  if (search.kind === 'list') return listLabel;
  return lang === 'hi' ? search.item.nameHi || search.item.nameEn : search.item.nameEn;
}

/** One card per live search (up to three): the item, how many replies, and a way back in. */
export function ActiveSearchCards({ searches, limit, navigate, onMakeList }: Props) {
  const { t, lang } = useT();
  const c = t.c;
  if (searches.length === 0) return null;
  return (
    <section className="cu-searches" aria-label={c.activeHeading}>
      <ul className="cu-searches__list">
        {searches.map((s) => {
          const label = searchLabel(s, lang, c.activeList(s.kind === 'list' ? s.lineCount : 0));
          const path = s.kind === 'list' ? `/app/list/${s.id}` : `/app/request/${s.id}`;
          return (
            <li key={`${s.kind}-${s.id}`}>
              <a className="cu-searches__card" {...appLink(navigate, path)}>
                <span className="cu-searches__title">{label}</span>
                <span className="cu-searches__meta">
                  {' · '}
                  {s.replies === 0 ? c.activeNoReplies : c.activeReplies(s.replies)}
                </span>
                <span className="cu-searches__view">
                  {' · '}
                  {c.activeView}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
      {onMakeList && searches.length < limit && (
        <Button variant="quiet" className="cu-searches__hint" onClick={onMakeList}>
          {c.activeListHint}
        </Button>
      )}
    </section>
  );
}
