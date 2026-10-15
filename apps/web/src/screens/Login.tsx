import { useState, type FormEvent } from 'react';
import { useT } from '../i18n/index.js';
import { ApiError, type ShopApi } from '../lib/api.js';

/** The three calls login needs; both the shop and the customer client have them. */
export type LoginApi = Pick<ShopApi, 'requestOtp' | 'devInbox' | 'verifyOtp'>;

interface Props {
  api: LoginApi;
  onLoggedIn: (token: string) => void;
}

/** An Indian mobile as people type it: 10 digits, optionally with +91, 91 or 0 in front. */
const PHONE = /^(?:\+?91|0)?[6-9]\d{9}$/;

export function Login({ api, onLoggedIn }: Props) {
  const { t } = useT();
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const cleanPhone = phone.replace(/[\s-]/g, '');

  async function guard(work: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (e) {
      if (e instanceof ApiError && e.status === 429) setError(t.errTooManyOtp);
      else if (e instanceof ApiError && e.code === 'invalid_code') setError(t.errBadCode);
      else if (e instanceof ApiError && e.status === 400) setError(t.errBadPhone);
      else setError(t.errGeneric);
    } finally {
      setBusy(false);
    }
  }

  function sendOtp(event: FormEvent) {
    event.preventDefault();
    if (!PHONE.test(cleanPhone)) {
      setError(t.errBadPhone);
      return;
    }
    void guard(async () => {
      await api.requestOtp(cleanPhone);
      setStep('code');
    });
  }

  function verify(event: FormEvent) {
    event.preventDefault();
    void guard(async () => {
      const { token } = await api.verifyOtp(cleanPhone, code);
      onLoggedIn(token);
    });
  }

  function fillDemoCode() {
    void guard(async () => {
      const demo = await api.devInbox(cleanPhone);
      if (demo === null) setError(t.errNoDemoCode);
      else setCode(demo);
    });
  }

  return (
    <form className="stack" onSubmit={step === 'phone' ? sendOtp : verify}>
      <label className="field">
        <span>{t.phoneLabel}</span>
        <input
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={phone}
          readOnly={step === 'code'}
          onChange={(event) => setPhone(event.target.value)}
        />
      </label>

      {step === 'phone' ? (
        <button type="submit" className="btn btn-yes" disabled={busy}>
          {t.sendOtp}
        </button>
      ) : (
        <>
          <label className="field">
            <span>{t.otpLabel}</span>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
            />
          </label>

          {/* OTP_MODE=simulated is the only mode (ADR-0013); this box goes with the inbox endpoint. */}
          <section className="demo-box" aria-label={t.demoTitle}>
            <strong>{t.demoTitle}</strong>
            <p>{t.demoNote}</p>
            <button type="button" className="btn btn-quiet" disabled={busy} onClick={fillDemoCode}>
              {t.demoFill}
            </button>
          </section>

          <button type="submit" className="btn btn-yes" disabled={busy || code.length !== 6}>
            {t.login}
          </button>
          <button
            type="button"
            className="btn btn-quiet"
            disabled={busy}
            onClick={() => void guard(() => api.requestOtp(cleanPhone))}
          >
            {t.sendOtp}
          </button>
        </>
      )}

      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
