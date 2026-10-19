/** "Sharma Kirana Store" → "SK". */
export function initialsOf(name: string): string {
  const letters = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => Array.from(word)[0] ?? '');
  return letters.join('').toUpperCase() || '?';
}

interface Props {
  name: string;
  logoUrl: string | null;
  /** Diameter in px. */
  size: number;
}

/** The shop's logo in a circle, or its initials when there is none. Decorative: the name sits beside it. */
export function ShopLogo({ name, logoUrl, size }: Props) {
  return logoUrl ? (
    <img className="sh-logo" src={logoUrl} alt="" style={{ width: size, height: size }} />
  ) : (
    <span
      className="sh-logo sh-logo--initials"
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
    >
      {initialsOf(name)}
    </span>
  );
}
