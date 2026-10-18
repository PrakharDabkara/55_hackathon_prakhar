import { useT } from '../i18n/index.js';
import type { DeliveryDefaults } from '../lib/api.js';
import { parseFee, parseMinutes } from '../lib/offer.js';

export interface DeliveryState {
  enabled: boolean;
  fee: string;
  minutes: string;
}

/** What a standing offer or a yes pre-fills: rupees as typed ("20", "2.5"), minutes as a number. */
export function deliveryStateFrom(
  enabled: boolean,
  feePaise: number | null,
  minutes: number | null,
): DeliveryState {
  return {
    enabled,
    fee: feePaise === null ? '' : String(feePaise / 100),
    minutes: minutes === null ? '' : String(minutes),
  };
}

/**
 * The offer to send, or an error when a field is filled in wrongly. Nothing enabled: no offer.
 * A fee and a time are both optional; a fee of 0 is free delivery, not "not told".
 */
export function deliveryFrom(
  state: DeliveryState,
): { ok: true; value: DeliveryDefaults | undefined } | { ok: false } {
  if (!state.enabled) return { ok: true, value: undefined };
  const value: DeliveryDefaults = {};
  if (state.fee.trim() !== '') {
    const fee = parseFee(state.fee);
    if (fee === null) return { ok: false };
    value.feePaise = fee;
  }
  if (state.minutes.trim() !== '') {
    const minutes = parseMinutes(state.minutes);
    if (minutes === null) return { ok: false };
    value.minutes = minutes;
  }
  return { ok: true, value };
}

interface Props {
  state: DeliveryState;
  onChange: (next: DeliveryState) => void;
  /** A one-tap switch on the answer card, or a plain checkbox in the settings. */
  control: 'switch' | 'checkbox';
  disabled?: boolean;
}

/** "Ghar bhej denge": an on/off, and when on an optional fee and an optional time. */
export function DeliveryFields({ state, onChange, control, disabled = false }: Props) {
  const { t } = useT();
  const label = control === 'switch' ? t.deliveryOffer : t.deliveryStanding;
  const toggle = (enabled: boolean) => onChange({ ...state, enabled });
  return (
    <div className="delivery-fields">
      {control === 'switch' ? (
        <button
          type="button"
          role="switch"
          aria-checked={state.enabled}
          aria-label={label}
          className="btn btn-quiet"
          disabled={disabled}
          onClick={() => toggle(!state.enabled)}
        >
          {state.enabled ? '✓ ' : ''}
          {label}
        </button>
      ) : (
        <label className="check-option">
          <input
            type="checkbox"
            checked={state.enabled}
            disabled={disabled}
            onChange={(event) => toggle(event.target.checked)}
          />
          <span>{label}</span>
        </label>
      )}
      {state.enabled && (
        <>
          <label className="field">
            <span>{t.deliveryFeeLabel}</span>
            <input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={state.fee}
              onChange={(event) => onChange({ ...state, fee: event.target.value })}
            />
          </label>
          <label className="field">
            <span>{t.deliveryMinutesLabel}</span>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={state.minutes}
              onChange={(event) => onChange({ ...state, minutes: event.target.value })}
            />
          </label>
        </>
      )}
    </div>
  );
}
