/** A phone-sized browser window, for the desktop notice. */
export const PHONE_WIDTH = 420;
export const PHONE_HEIGHT = 860;
const GAP = 16;

export const BUYER_PATH = '/app/';
export const SHOP_PATH = '/app/shop';

interface Area {
  width: number;
  height: number;
}

/** The window.open features for `count` phone windows in a row, centred on the free screen area. */
export function phoneFeatures(count: number, area: Area): string[] {
  const height = Math.min(PHONE_HEIGHT, area.height);
  const row = count * PHONE_WIDTH + (count - 1) * GAP;
  const left = Math.max(0, Math.round((area.width - row) / 2));
  const top = Math.max(0, Math.round((area.height - height) / 2));
  return Array.from(
    { length: count },
    (_, i) =>
      `width=${PHONE_WIDTH},height=${height},left=${left + i * (PHONE_WIDTH + GAP)},top=${top}`,
  );
}

/** Opens each [url, name] in a phone-sized window; false when the browser blocked any of them. */
export function openPhoneWindows(targets: [url: string, name: string][]): boolean {
  const features = phoneFeatures(targets.length, {
    width: window.screen.availWidth,
    height: window.screen.availHeight,
  });
  // No "noopener": it makes window.open return null, which is how a blocked popup is told apart.
  // The windows are this same site.
  return targets.every(([url, name], i) => window.open(url, name, features[i]) !== null);
}
