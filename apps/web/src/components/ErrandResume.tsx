import '../customer/find.css';
import { useT } from '../i18n/index.js';
import type { ErrandListItem } from '../lib/seekerApi.js';
import { Icon } from '../ui/Icon.js';
import { appLink } from '../customer/ordersShared.js';

/** "Continue your errand": the way back into an errand still running or just finished. One link. */
export function ErrandResume({
  errand,
  navigate,
}: {
  errand: ErrandListItem;
  navigate: (path: string) => void;
}) {
  const { t } = useT();
  const c = t.c;
  return (
    <a
      className="cu-find__errand cu-find__errand--resume"
      {...appLink(navigate, `/app/errand/${errand.id}`)}
    >
      <span className="cu-find__errand-text">
        <span className="sh-heading">{c.findErrandContinue}</span>
        <span className="sh-helper cu-find__errand-task">{errand.task}</span>
        <span className="cu-pill">{c.errandState(errand.state)}</span>
      </span>
      <Icon name="right" size={20} className="cu-find__chevron" />
    </a>
  );
}
