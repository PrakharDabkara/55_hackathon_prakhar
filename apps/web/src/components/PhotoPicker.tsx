import { useRef, useState, type ChangeEvent } from 'react';
import { useT } from '../i18n/index.js';
import '../customer/find.css';
import { Button } from '../ui/Button.js';
import { Icon } from '../ui/Icon.js';
import { ApiError } from '../lib/api.js';
import { blobToDataUrl, shrinkPhoto } from '../lib/photo.js';
import type { PhotoApi } from '../lib/photoApi.js';

interface Props {
  api: PhotoApi;
  /** A customer's photo of what they want, or a shop's photo of what it has. */
  role: 'request' | 'answer';
  /** The checklist item of an errand this photo is for. */
  errand?: { id: string; label: string };
  /** Names the picker for a screen reader when there are several ("Photo jodein: chini"). */
  label?: string;
  /** The photo id once it is uploaded, null when it is removed. */
  onChange: (photoId: string | null) => void;
  /** For tests: a stand-in for the canvas shrink. */
  prepare?: (file: File) => Promise<Blob>;
}

type State =
  | { kind: 'idle' }
  | { kind: 'working'; percent: number | null }
  | { kind: 'done'; preview: string };

/**
 * "Photo jodein": optional, never in the way. Picks a picture, shrinks it in the browser (at most
 * 1024 px, about 100 KB, no EXIF), uploads it with progress and shows a small preview. A failure is
 * said in plain words and the screen goes on without a photo.
 */
export function PhotoPicker({ api, role, errand, label, onChange, prepare = shrinkPhoto }: Props) {
  const { t } = useT();
  const c = t.c;
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [error, setError] = useState<string | null>(null);

  function messageFor(failure: unknown): string {
    if (failure instanceof ApiError) {
      if (failure.code === 'photo_too_large') return c.findPhotoTooLarge;
      if (failure.code === 'photo_limit') return c.findPhotoLimit;
      if (failure.code === 'invalid_image') return c.findPhotoBad;
      if (failure.code === 'network') return c.findPhotoNetwork;
      if (failure.code === 'photo_storage_full') return c.findPhotoFull;
    }
    return c.findPhotoFailed;
  }

  async function chosen(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError(null);
    setState({ kind: 'working', percent: null });
    try {
      const small = await prepare(file);
      const preview = await blobToDataUrl(small);
      const { id } = await api.uploadPhoto(small, {
        role,
        ...(errand && { errand }),
        onProgress: (percent) => setState({ kind: 'working', percent }),
      });
      setState({ kind: 'done', preview });
      onChange(id);
    } catch (failure) {
      setState({ kind: 'idle' });
      setError(messageFor(failure));
    }
  }

  function remove() {
    setState({ kind: 'idle' });
    onChange(null);
  }

  return (
    <div className="cu-photo">
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        tabIndex={-1}
        onChange={(event) => void chosen(event)}
      />
      {state.kind === 'idle' && (
        <Button variant="quiet" className="cu-photo__add" onClick={() => input.current?.click()}>
          <Icon name="photo" size={20} />
          {label ? c.findAddPhotoFor(label) : c.findAddPhoto}
        </Button>
      )}
      {state.kind === 'working' && (
        <div className="cu-photo__progress">
          <p role="status" className="sh-label">
            {state.percent === null ? c.findPhotoPreparing : c.findPhotoUploading(state.percent)}
          </p>
          <div
            className="cu-photo__bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={state.percent ?? 0}
          >
            <span style={{ width: `${state.percent ?? 0}%` }} />
          </div>
        </div>
      )}
      {state.kind === 'done' && (
        <div className="cu-photo__done">
          <img className="cu-photo__thumb" src={state.preview} alt={c.findPhotoAlt} />
          <Button variant="quiet" onClick={remove}>
            {c.findRemovePhoto}
          </Button>
        </div>
      )}
      {error && (
        <p className="sh-alert" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
