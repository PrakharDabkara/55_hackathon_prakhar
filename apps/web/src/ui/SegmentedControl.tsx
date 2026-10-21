interface Props<T extends string> {
  label: string;
  options: { value: T; label: string; disabled?: boolean }[];
  value: T;
  onChange: (value: T) => void;
}

/** Two or three choices side by side; the chosen one is aria-pressed. */
export function SegmentedControl<T extends string>({ label, options, value, onChange }: Props<T>) {
  return (
    <div className="sh-segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          {...(option.disabled && { disabled: true })}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
