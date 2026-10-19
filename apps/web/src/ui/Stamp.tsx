import { useT } from '../i18n/index.js';

/** ANSWERED or NOT AVAILABLE, rotated, double-bordered; it lands with a short scale-down. */
export function Stamp({ variant }: { variant: 'yes' | 'no' }) {
  const { t } = useT();
  return (
    <span className={`sh-stamp sh-stamp--${variant}`}>
      {variant === 'yes' ? t.shop.stampAnswered : t.shop.stampNotAvailable}
    </span>
  );
}
