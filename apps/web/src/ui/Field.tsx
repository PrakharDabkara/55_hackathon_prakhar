import { useId, type InputHTMLAttributes, type ReactNode } from 'react';

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, 'prefix'> {
  label: string;
  helper?: string;
  error?: string | null;
  /** Fixed text before the value, such as +91 or ₹. */
  prefix?: ReactNode;
  /** A required field: a * after the label (drawn in CSS) and aria-required for assistive tech. */
  required?: boolean;
}

/** A label, an input (never under 16 px), a helper line and an error line, all tied together. */
export function Field({ label, helper, error, prefix, required, className, id, ...input }: Props) {
  const auto = useId();
  const inputId = id ?? auto;
  const helperId = `${inputId}-help`;
  const errorId = `${inputId}-error`;
  const described = [helper && helperId, error && errorId].filter(Boolean).join(' ');
  return (
    <div className={`sh-field${className ? ` ${className}` : ''}`}>
      <label htmlFor={inputId} className={`sh-label${required ? ' sh-label--required' : ''}`}>
        {label}
      </label>
      <div className="sh-input-wrap">
        {prefix !== undefined && (
          <span className="sh-prefix" aria-hidden="true">
            {prefix}
          </span>
        )}
        <input
          id={inputId}
          className="sh-input"
          {...(described && { 'aria-describedby': described })}
          {...(required && { 'aria-required': true })}
          {...(error && { 'aria-invalid': true })}
          {...input}
        />
      </div>
      {helper && (
        <p id={helperId} className="sh-helper">
          {helper}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="sh-error">
          {error}
        </p>
      )}
    </div>
  );
}
