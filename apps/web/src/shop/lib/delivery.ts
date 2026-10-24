import type { DeliveryDefaults } from '../../lib/api.js';
import { parseFee } from '../../lib/offer.js';

/** What the delivery form holds while it is being filled: text as typed, minutes as chosen. */
export interface DeliveryForm {
  delivers: boolean;
  fee: string;
  minutes: number | null;
  km: string;
}

export const emptyDeliveryForm = (): DeliveryForm => ({
  delivers: false,
  fee: '',
  minutes: null,
  km: '',
});

export type DeliveryCheck =
  | { ok: true; delivery: DeliveryDefaults | null; maxKm: number | null }
  | { ok: false; errors: { fee?: true; km?: true } };

/**
 * The form read as the API wants it. Not delivering is `delivery: null`. A fee or a distance that is
 * not a number is an error only while the shop delivers; with delivery off they are ignored.
 */
export function checkDelivery(form: DeliveryForm): DeliveryCheck {
  if (!form.delivers) return { ok: true, delivery: null, maxKm: null };
  const feePaise = form.fee.trim() === '' ? null : parseFee(form.fee);
  const limit = form.km.trim() === '' ? null : Number(form.km.replace(',', '.'));
  const errors: { fee?: true; km?: true } = {};
  if (form.fee.trim() !== '' && feePaise === null) errors.fee = true;
  if (limit !== null && !(Number.isFinite(limit) && limit >= 0.1 && limit <= 100)) errors.km = true;
  if (errors.fee || errors.km) return { ok: false, errors };
  return {
    ok: true,
    delivery: {
      ...(feePaise !== null && { feePaise }),
      ...(form.minutes !== null && { minutes: form.minutes }),
    },
    maxKm: limit,
  };
}
