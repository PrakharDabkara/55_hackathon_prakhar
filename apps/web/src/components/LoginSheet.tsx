import { useState, type FormEvent } from 'react';
import '../customer/find.css';
import { useT } from '../i18n/index.js';
import { ApiError } from '../lib/api.js';
import type { SeekerApi } from '../lib/seekerApi.js';
import { BottomSheet } from '../ui/BottomSheet.js';
import { BrandMark } from '../ui/BrandMark.js';
import { Button } from '../ui/Button.js';
import { Field } from '../ui/Field.js';

interface Props {
  api: Pick<SeekerApi, 'requestOtp' | 'devInbox' | 'verifyOtp'>;
  open: boolean;
  onClose: () => void;
  onLoggedIn: (token: string) => void;
}

/** An Indian mobile as people type it: 10 digits, optionally with +91, 91 or 0 in front. */
const PHONE = /^(?:\+?91|0)?[6-9]\d{9}$/;

const FORM = 'login-sheet-form';

/** The customer's login: mobile, then a 6-digit code. Opens over whatever the customer was doing. */
export function LoginSheet({ open, ...rest }: Props) {
  return open ? <Sheet {...rest} /> : null;
}

function Sheet({ api, onClose, onLoggedIn }: Omit<Props, 'open'>) {
  const { t } = useT();
  const c = t.c;
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

  function sendOtp() {
    if (!PHONE.test(cleanPhone)) {
      setError(t.errBadPhone);
      return;
    }
    void guard(async () => {
      await api.requestOtp(cleanPhone);
      setStep('code');
    });
  }

  function verify() {
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

  function submit(event: FormEvent) {
    event.preventDefault();
    if (step === 'phone') sendOtp();
    else verify();
  }

  return (
    <BottomSheet
      open
      title={c.loginTitle}
      onClose={onClose}
      footer={
        <Button
          type="submit"
          form={FORM}
          variant="solid"
          className="sh-btn--block"
          disabled={busy || (step === 'code' && code.length !== 6)}
        >
          {step === 'phone' ? c.loginSendCode : c.loginSubmit}
        </Button>
      }
    >
      <form id={FORM} className="cu-find__form" onSubmit={submit}>
        <div className="cu-login__brand">
          <BrandMark size={40} />
          <p className="sh-helper">{c.findTagline}</p>
        </div>
        <Field
          label={c.loginPhone}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          prefix="+91"
          value={phone}
          readOnly={step === 'code'}
          onChange={(event) => setPhone(event.target.value)}
        />
        {step === 'code' && (
          <>
            <Field
              label={c.loginCode}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
            />
            {/* OTP_MODE=simulated is the only mode (ADR-0013); this box goes with the inbox endpoint. */}
            <section className="cu-find__demo" aria-label={c.loginDemoTitle}>
              <p className="sh-label">{c.loginDemoTitle}</p>
              <p className="sh-helper">{c.loginDemoNote}</p>
              <Button variant="secondary" disabled={busy} onClick={fillDemoCode}>
                {c.loginDemoFill}
              </Button>
            </section>
            <Button
              variant="quiet"
              disabled={busy}
              onClick={() => void guard(() => api.requestOtp(cleanPhone))}
            >
              {c.loginResend}
            </Button>
          </>
        )}
        {error && (
          <p className="sh-alert" role="alert">
            {error}
          </p>
        )}
        <p className="sh-helper">{c.loginPrivacy}</p>
      </form>
    </BottomSheet>
  );
}
