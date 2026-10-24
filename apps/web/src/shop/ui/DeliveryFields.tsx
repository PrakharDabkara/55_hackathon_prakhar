import { useT } from '../../i18n/index.js';
import { Chip } from '../../ui/Chip.js';
import { Field } from '../../ui/Field.js';
import { Switch } from '../../ui/Switch.js';
import type { DeliveryForm } from '../lib/delivery.js';

const MINUTES = [15, 30, 60] as const;

interface Props {
  value: DeliveryForm;
  onChange: (next: DeliveryForm) => void;
  errors?: { fee?: true; km?: true };
}

/** The delivery form: whether the shop delivers, the usual fee and time, how far. Shared by Delivery and Setup. */
export function DeliveryFields({ value, onChange, errors = {} }: Props) {
  const { t } = useT();
  const s = t.shop;
  const set = (patch: Partial<DeliveryForm>) => onChange({ ...value, ...patch });
  return (
    <>
      <Switch
        checked={value.delivers}
        onChange={(delivers) => set({ delivers })}
        label={s.iDeliver}
      />
      {value.delivers && (
        <>
          <Field
            label={s.defaultFee}
            inputMode="decimal"
            autoComplete="off"
            value={value.fee}
            error={errors.fee ? s.errFee : null}
            onChange={(event) => set({ fee: event.target.value })}
          />
          <div className="sh-field">
            <span className="sh-label">{s.usualTime}</span>
            <div className="sh-chips">
              {MINUTES.map((m) => (
                <Chip key={m} pressed={value.minutes === m} onClick={() => set({ minutes: m })}>
                  {m === 15 ? s.min15 : m === 30 ? s.min30 : s.hour1}
                </Chip>
              ))}
            </div>
          </div>
          <Field
            label={s.upToKm}
            inputMode="decimal"
            autoComplete="off"
            helper={s.noLimit}
            value={value.km}
            error={errors.km ? s.errKm : null}
            onChange={(event) => set({ km: event.target.value })}
          />
        </>
      )}
    </>
  );
}
