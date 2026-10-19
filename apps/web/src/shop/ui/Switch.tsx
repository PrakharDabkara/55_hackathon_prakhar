import type { ReactNode } from 'react';

interface Props {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: ReactNode;
  disabled?: boolean;
}

/** An on/off row: the whole row is the 48 px target. */
export function Switch({ checked, onChange, label, disabled = false }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className="sh-switch"
      onClick={() => onChange(!checked)}
    >
      <span className="sh-switch__label">{label}</span>
      <span className="sh-switch__track" aria-hidden="true">
        <span className="sh-switch__thumb" />
      </span>
    </button>
  );
}
