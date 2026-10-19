import type { ReactNode } from 'react';
import { Icon } from '../ui/Icon.js';
import { useT } from '../i18n/index.js';

interface Props {
  title: string;
  onBack: () => void;
  /** An action on the right, such as a Cancel button. */
  right?: ReactNode;
}

/** The top bar of every customer screen but Find: a back button and the screen's name. */
export function ScreenBar({ title, onBack, right }: Props) {
  const { t } = useT();
  return (
    <header className="cu-bar">
      <button type="button" className="sh-icon-btn" aria-label={t.c.back} onClick={onBack}>
        <Icon name="left" />
      </button>
      <h1 className="sh-heading cu-bar__title">{title}</h1>
      {right}
    </header>
  );
}
