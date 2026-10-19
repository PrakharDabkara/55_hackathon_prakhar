import { useRef, useState, type ChangeEvent } from 'react';
import { useT } from '../../i18n/index.js';
import { blobToDataUrl, shrinkPhoto } from '../../lib/photo.js';
import type { PhotoApi } from '../../lib/photoApi.js';
import { Button } from '../../ui/Button.js';
import { Icon } from '../../ui/Icon.js';

interface Props {
  api: PhotoApi;
  /** The photo id once uploaded, null when removed. */
  onChange: (photoId: string | null) => void;
  /** For tests: a stand-in for the canvas shrink. */
  prepare?: (file: File) => Promise<Blob>;
}

type State =
  | { kind: 'idle' }
  | { kind: 'working'; percent: number | null }
  | { kind: 'done'; preview: string };

/**
 * "Add a photo": the shop's own picture of what it has, with a yes. Shrunk in the browser (about
 * 100 KB, no EXIF) and uploaded with progress, as in the customer app. Optional, never in the way.
 */
export function PhotoRow({ api, onChange, prepare = shrinkPhoto }: Props) {
  const { t } = useT();
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [error, setError] = useState(false);

  async function chosen(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError(false);
    setState({ kind: 'working', percent: null });
    try {
      const small = await prepare(file);
      const preview = await blobToDataUrl(small);
      const { id } = await api.uploadPhoto(small, {
        role: 'answer',
        onProgress: (percent) => setState({ kind: 'working', percent }),
      });
      setState({ kind: 'done', preview });
      onChange(id);
    } catch {
      setState({ kind: 'idle' });
      setError(true);
    }
  }

  return (
    <div className="sh-photorow">
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        tabIndex={-1}
        onChange={(event) => void chosen(event)}
      />
      {state.kind === 'idle' && (
        <Button variant="quiet" className="sh-photorow__add" onClick={() => input.current?.click()}>
          <Icon name="camera" />
          {t.shop.addPhoto}
        </Button>
      )}
      {state.kind === 'working' && (
        <p role="status" className="sh-label sh-muted">
          {state.percent === null ? t.shop.photoPreparing : t.shop.photoUploading(state.percent)}
        </p>
      )}
      {state.kind === 'done' && (
        <div className="sh-photorow__done">
          <img className="sh-photorow__thumb" src={state.preview} alt={t.shop.photoPreview} />
          <Button
            variant="quiet"
            onClick={() => {
              setState({ kind: 'idle' });
              onChange(null);
            }}
          >
            {t.shop.removePhoto}
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="sh-error">
          {t.shop.photoFailed}
        </p>
      )}
    </div>
  );
}
