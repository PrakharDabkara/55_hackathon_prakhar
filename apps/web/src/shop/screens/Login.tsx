import { useState, type FormEvent } from 'react';
import { BRAND_NAME } from '../../brand.js';
import { useT } from '../../i18n/index.js';
import { ApiError, type ShopApi } from '../../lib/api.js';
import { BrandMark } from '../../ui/BrandMark.js';
import { Button } from '../../ui/Button.js';
import { Field } from '../../ui/Field.js';

export type LoginApi = Pick<ShopApi, 'requestOtp' | 'devInbox' | 'verifyOtp'>;

interface Props {
  api: LoginApi;
  onLoggedIn: (token: string) => void;
}

/** An Indian mobile as people type it: 10 digits, optionally with +91, 91 or 0 in front. */
const PHONE = /^(?:\+?91|0)?[6-9]\d{9}$/;

/** Screen A: the brand at the top, the phone number at the bottom where the thumb is. */
export function Login({ api, onLoggedIn }: Props) {
  const { t } = useT();
  const s = t.shop;
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Whatever the shop typed, the server gets the 10 digits.
  const typed = phone.replace(/[\s-]/g, '');
  const digits = typed.replace(/^(?:\+?91|0)/, '');

  async function guard(work: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (e) {
      if (e instanceof ApiError && e.status === 429) setError(s.errTooMany);
      else if (e instanceof ApiError && e.code === 'invalid_code') setError(s.errBadCode);
      else if (e instanceof ApiError && e.status === 400) setError(s.errBadPhone);
      else setError(s.errGeneric);
    } finally {
      setBusy(false);
    }
  }

  function sendCode(event: FormEvent) {
    event.preventDefault();
    if (!PHONE.test(typed)) {
      setError(s.errBadPhone);
      return;
    }
    void guard(async () => {
      await api.requestOtp(digits);
      setStep('code');
    });
  }

  function verify(event: FormEvent) {
    event.preventDefault();
    void guard(async () => {
      const { token } = await api.verifyOtp(digits, code);
      onLoggedIn(token);
    });
  }

  return (
    <div className="sh-login">
      <header className="sh-login__brand">
        <BrandMark size={72} />
        <h1 className="sh-display">{BRAND_NAME}</h1>
        <p className="sh-body sh-muted">{s.forShops}</p>
      </header>

      <form className="sh-login__form" onSubmit={step === 'phone' ? sendCode : verify}>
        <Field
          label={s.mobileNumber}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          prefix="+91"
          value={phone}
          readOnly={step === 'code'}
          {...(step === 'phone' && { helper: s.codeHelper })}
          onChange={(event) => setPhone(event.target.value)}
        />

        {step === 'phone' ? (
          <Button type="submit" variant="primary" className="sh-btn--block" disabled={busy}>
            {s.sendCode}
          </Button>
        ) : (
          <>
            <Field
              label={s.codeLabel}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              helper={s.codeSentTo(digits)}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
            />
            {/* OTP_MODE=simulated is the only mode (ADR-0013); this box goes with the inbox endpoint. */}
            <section className="sh-demo" aria-label={s.demoTitle}>
              <p className="sh-label">{s.demoTitle}</p>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  void guard(async () => {
                    const demo = await api.devInbox(digits);
                    if (demo === null) setError(s.errNoDemo);
                    else setCode(demo);
                  })
                }
              >
                {s.demoFill}
              </Button>
            </section>
            <Button
              type="submit"
              variant="primary"
              className="sh-btn--block"
              disabled={busy || code.length !== 6}
            >
              {s.verify}
            </Button>
            <Button
              variant="quiet"
              disabled={busy}
              onClick={() => void guard(() => api.requestOtp(digits))}
            >
              {s.resend}
            </Button>
          </>
        )}
        {error && (
          <p className="sh-alert" role="alert">
            {error}
          </p>
        )}
      </form>
    </div>
  );
}
