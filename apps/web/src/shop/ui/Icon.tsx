import type { SVGProps } from 'react';

const PATHS = {
  menu: 'M4 7h16M4 12h16M4 17h16',
  close: 'M6 6l12 12M18 6L6 18',
  left: 'M15 5l-7 7 7 7',
  right: 'M9 5l7 7-7 7',
  camera: 'M4 8h3l1.5-2h7L17 8h3v11H4zM12 17a3.5 3.5 0 100-7 3.5 3.5 0 000 7z',
  plus: 'M12 5v14M5 12h14',
  bell: 'M6 17V11a6 6 0 0112 0v6l1.5 2h-15zM10 21h4',
  requests: 'M5 4h14v16l-3-2-2 2-2-2-2 2-2-2-3 2zM8 9h8M8 13h5',
  orders: 'M5 8h14l-1 12H6zM9 8a3 3 0 016 0',
  insights: 'M5 20V10M12 20V4M19 20v-7',
  delivery:
    'M3 7h11v9H3zM14 10h4l3 3v3h-7M7 19a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM17 19a1.5 1.5 0 100-3 1.5 1.5 0 000 3z',
  settings:
    'M12 15a3 3 0 100-6 3 3 0 000 6zM19 12l2-1-1-3-2 .5-1.5-1.5.5-2-3-1-1 2h-2l-1-2-3 1 .5 2L6 8.5 4 8l-1 3 2 1v2l-2 1 1 3 2-.5L7.5 19l-.5 2 3 1 1-2h2l1 2 3-1-.5-2 1.5-1.5 2 .5 1-3-2-1z',
  logout: 'M10 4H5v16h5M15 8l4 4-4 4M19 12H9',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  pin: 'M12 21s-6-5.5-6-10a6 6 0 0112 0c0 4.500-6 10-6 10zM12 13a2.500 2.500 0 100-5 2.500 2.500 0 000 5z',
  photo: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M9 9.500a1 1 0 100-2 1 1 0 000 2z',
} as const;

export type IconName = keyof typeof PATHS;

/** Inline SVG icons: no icon library, drawn on a 24-unit grid with the text colour. */
export function Icon({
  name,
  size = 24,
  ...rest
}: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
