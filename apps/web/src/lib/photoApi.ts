import { ApiError, type ClientOptions } from './api.js';
import { blobToDataUrl } from './photo.js';

/** What the screens use to add and show photos (ADR-0030). */
export interface PhotoApi {
  /** Sends a (shrunk) picture. `role`: a customer's photo of what they want, or a shop's of what it has. */
  uploadPhoto(
    blob: Blob,
    options: {
      role: 'request' | 'answer';
      /** A checklist item of an errand the photo is for. */
      errand?: { id: string; label: string };
      /** Whole percent sent so far. */
      onProgress?: (percent: number) => void;
    },
  ): Promise<{ id: string }>;
  /** The picture as a data: URL, fetched with the login (an <img> cannot send it). */
  photoSrc(id: string): Promise<string>;
}

export interface PhotoClientOptions extends ClientOptions {
  /** For tests: a stand-in for XMLHttpRequest. */
  xhr?: () => XMLHttpRequest;
}

export function createPhotoApi({
  getToken,
  onUnauthorized,
  fetchImpl = (input, init) => fetch(input, init),
  xhr = () => new XMLHttpRequest(),
}: PhotoClientOptions): PhotoApi {
  // A photo seen once is not fetched again while the page is open.
  const seen = new Map<string, Promise<string>>();

  return {
    uploadPhoto(blob, { role, errand, onProgress }) {
      const query = new URLSearchParams({ role });
      if (errand) {
        query.set('errandId', errand.id);
        query.set('label', errand.label);
      }
      return new Promise((resolve, reject) => {
        const request = xhr();
        request.open('POST', `/photos?${query.toString()}`);
        const token = getToken();
        if (token) request.setRequestHeader('Authorization', `Bearer ${token}`);
        request.setRequestHeader('Content-Type', 'image/jpeg');
        request.timeout = 60_000;
        // fetch cannot report upload progress; XMLHttpRequest can.
        request.upload.onprogress = (event) => {
          if (event.lengthComputable && onProgress)
            onProgress(Math.round((event.loaded / event.total) * 100));
        };
        request.onload = () => {
          let data: { id?: string; error?: { code?: string; message?: string } } = {};
          try {
            data = JSON.parse(request.responseText) as typeof data;
          } catch {
            // Not JSON: keep the defaults.
          }
          if (request.status >= 200 && request.status < 300 && data.id) {
            resolve({ id: data.id });
            return;
          }
          const code = data.error?.code ?? 'unknown';
          if (request.status === 401 && code === 'unauthorized') onUnauthorized();
          reject(new ApiError(request.status, code, data.error?.message ?? 'Upload failed'));
        };
        request.onerror = () => reject(new ApiError(0, 'network', 'No connection'));
        request.ontimeout = () => reject(new ApiError(0, 'network', 'The upload timed out'));
        request.send(blob);
      });
    },

    photoSrc(id) {
      const known = seen.get(id);
      if (known) return known;
      const loading = (async () => {
        const headers: Record<string, string> = {};
        const token = getToken();
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const res = await fetchImpl(`/photos/${encodeURIComponent(id)}`, { headers });
        if (!res.ok) throw new ApiError(res.status, 'photo_unavailable', 'No such photo');
        const bytes = await res.blob();
        return blobToDataUrl(bytes.type ? bytes : new Blob([bytes], { type: 'image/jpeg' }));
      })();
      seen.set(id, loading);
      // A failure is not remembered: the next look may work.
      loading.catch(() => seen.delete(id));
      return loading;
    },
  };
}
