/** The longest side of a photo we send: phones take 4000 px; shops and customers need to see, not to print. */
export const MAX_SIDE_PX = 1024;
/** About how big the file should be. Under 400 KB is the server's hard limit; this keeps data use small. */
export const TARGET_BYTES = 100 * 1024;

/** The size after shrinking: at most 1024 px on the longest side, never enlarged, never a zero side. */
export function fitWithin(
  width: number,
  height: number,
  max: number = MAX_SIDE_PX,
): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

const QUALITIES = [0.8, 0.7, 0.6, 0.5, 0.4, 0.3];

/**
 * Tries JPEG qualities from high to low and takes the first file under the target size; if none
 * fits, the smallest one made. `encode` returns null when the browser cannot encode.
 */
export async function chooseEncoding(
  encode: (quality: number) => Promise<Blob | null>,
  target: number = TARGET_BYTES,
): Promise<Blob> {
  let smallest: Blob | null = null;
  for (const quality of QUALITIES) {
    const blob = await encode(quality);
    if (!blob) throw new Error('The browser could not encode the photo');
    if (blob.size <= target) return blob;
    if (!smallest || blob.size < smallest.size) smallest = blob;
  }
  return smallest as Blob;
}

/**
 * Shrinks a picture from the camera or gallery in the browser: decodes it (applying its orientation),
 * draws it at most 1024 px wide or tall on a canvas and encodes a JPEG of about 100 KB. A canvas
 * copy carries no EXIF, so the GPS position never leaves the phone. (The server strips it again.)
 */
export async function shrinkPhoto(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('The browser cannot draw the photo');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    return await chooseEncoding(
      (quality) => new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality)),
    );
  } finally {
    bitmap.close();
  }
}

/** A blob as a data: URL (the page's CSP allows data: images, not blob: ones). */
export const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('could not read the photo'));
    reader.readAsDataURL(blob);
  });
