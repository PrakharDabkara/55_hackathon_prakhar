import { useEffect, useState } from 'react';
import { useT } from '../i18n/index.js';
import type { PhotoApi } from '../lib/photoApi.js';
import { Icon } from '../ui/Icon.js';

interface Props {
  api: PhotoApi;
  id: string;
  /** What the photo is ("Dukaan ki photo"): its name for a screen reader. */
  alt: string;
  /**
   * Show a small "Photo" button (camera icon and label) instead of the thumbnail; tapping it opens
   * the big picture. `close` names the button that closes it.
   */
  chip?: { label: string; close: string };
}

/**
 * A photo only the right people may see: fetched with the login, shown small, big on tap. If it
 * cannot be loaded (gone, not allowed) nothing is shown and nothing is said: a photo is a bonus.
 */
export function AuthPhoto({ api, id, alt, chip }: Props) {
  const { t } = useT();
  const [src, setSrc] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    api.photoSrc(id).then(
      (url) => alive && setSrc(url),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [api, id]);

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [open]);

  if (!src) return null;
  return (
    <>
      {chip ? (
        <button type="button" className="cu-photo-chip" onClick={() => setOpen(true)}>
          <Icon name="camera" size={18} />
          {chip.label}
        </button>
      ) : (
        <button
          type="button"
          className="photo-button"
          aria-label={t.photoEnlarge(alt)}
          onClick={() => setOpen(true)}
        >
          <img className="photo-thumb" src={src} alt={alt} />
        </button>
      )}
      {open && (
        <div className="lightbox" role="dialog" aria-modal="true" aria-label={alt}>
          <img className="lightbox-img" src={src} alt={alt} />
          <button type="button" className="sh-btn sh-btn--secondary" onClick={() => setOpen(false)}>
            {chip ? chip.close : t.photoClose}
          </button>
        </div>
      )}
    </>
  );
}
