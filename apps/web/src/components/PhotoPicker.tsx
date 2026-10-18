import { useRef, useState, type ChangeEvent } from 'react';
import { useT } from '../i18n/index.js';
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
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [error, setError] = useState<string | null>(null);

  function messageFor(failure: unknown): string {
    if (failure instanceof ApiError) {
      if (failure.code === 'photo_too_large') return t.errPhotoTooLarge;
      if (failure.code === 'photo_limit') return t.errPhotoLimit;
      if (failure.code === 'invalid_image') return t.errPhotoBad;
      if (failure.code === 'network') return t.errPhotoNetwork;
      if (failure.code === 'photo_storage_full') return t.errPhotoFull;
    }
    return t.errPhoto;
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
    <div className="photo-picker">
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        tabIndex={-1}
        onChange={(event) => void chosen(event)}
      />
      {state.kind === 'idle' && (
        <button
          type="button"
          className="btn btn-quiet photo-add"
          onClick={() => input.current?.click()}
        >
          {label ? t.photoAddFor(label) : t.photoAdd}
        </button>
      )}
      {state.kind === 'working' && (
        <div className="photo-progress">
          <p role="status">
            {state.percent === null ? t.photoPreparing : t.photoUploading(state.percent)}
          </p>
          <div
            className="progress"
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
        <div className="photo-done">
          <img className="photo-thumb" src={state.preview} alt={t.photoPreviewAlt} />
          <button type="button" className="btn btn-quiet" onClick={remove}>
            {t.photoRemove}
          </button>
        </div>
      )}
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
