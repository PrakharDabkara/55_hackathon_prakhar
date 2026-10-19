import type { ButtonHTMLAttributes } from 'react';

/** A toggle: pressed or not, announced with aria-pressed. */
export function Chip({
  pressed,
  className,
  ...rest
}: { pressed: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      className={`sh-chip${className ? ` ${className}` : ''}`}
      {...rest}
    />
  );
}
