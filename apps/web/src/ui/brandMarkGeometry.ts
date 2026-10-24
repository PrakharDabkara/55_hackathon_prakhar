/**
 * The AskBuy mark, drawn once on a 48 x 48 grid: a small slip with a torn top edge and two lines of
 * ink, and a location-pin dot at the lower right, on a rounded square. The BrandMark component
 * paints it with tokens; scripts/make-icons.ts paints the same shapes with explicit colours for the
 * PWA icons and the favicon, so the app and the icons never drift apart.
 */
export const MARK_SIZE = 48;
export const MARK_RADIUS = 11;
/** A slip: teeth cut into the top edge, a square bottom. */
export const MARK_PAPER =
  'M13 13L15 11L17 13L19 11L21 13L23 11L25 13L27 11L29 13L31 11L33 13L35 11V37H13Z';
/** Three thin slats at the foot of the slip: a shop shutter, rolled down. */
export const MARK_SLATS = ['M15 31H25', 'M15 33.500H25', 'M15 36H25'] as const;
export const MARK_LINES = ['M17 20H31', 'M17 26H27'] as const;
/** A pin: a drop with a round head, point down. */
export const MARK_PIN =
  'M35 44C30.500 40 28 36.800 28 33.800A7 7 0 0 1 42 33.800C42 36.800 39.500 40 35 44Z';
export const MARK_HOLE = { cx: 35, cy: 33.8, r: 2.6 } as const;
