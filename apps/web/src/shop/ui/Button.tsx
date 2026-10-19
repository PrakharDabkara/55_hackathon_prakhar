import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'ink' | 'danger';

const cls = (variant: ButtonVariant, extra?: string) =>
  `sh-btn sh-btn--${variant}${extra ? ` ${extra}` : ''}`;

/**
 * One primary (marigold) per screen. Secondary is outlined, quiet is plain brand-coloured text,
 * ink is the dark "Accept" on a request slip, danger confirms a cancel.
 */
export function Button({
  variant = 'secondary',
  className,
  type = 'button',
  ...rest
}: { variant?: ButtonVariant } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type={type} className={cls(variant, className)} {...rest} />;
}

/** A link that looks like a button (such as "Open map"). */
export function LinkButton({
  variant = 'secondary',
  className,
  external = false,
  ...rest
}: { variant?: ButtonVariant; external?: boolean } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a
      className={cls(variant, className)}
      {...(external && { target: '_blank', rel: 'noopener noreferrer' })}
      {...rest}
    />
  );
}
