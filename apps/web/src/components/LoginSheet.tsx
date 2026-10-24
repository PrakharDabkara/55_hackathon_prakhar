import type { FormEvent } from 'react';
import '../customer/find.css';
import { useT } from '../i18n/index.js';
import type { SeekerApi } from '../lib/seekerApi.js';
import { loginMessage, useOtpLogin } from '../lib/useOtpLogin.js';
import { BottomSheet } from '../ui/BottomSheet.js';
import { BrandMark } from '../ui/BrandMark.js';
import { Button } from '../ui/Button.js';
import { DemoNumbers } from '../ui/DemoNumbers.js';
import { Field } from '../ui/Field.js';

interface Props {
  api: Pick<SeekerApi, 'requestOtp' | 'devInbox' | 'verifyOtp' | 'demoNumbers'>;
  open: boolean;
  onClose: () => void;
  onLoggedIn: (token: string) => void;
}

const FORM = 'login-sheet-form';

/** The customer's login: mobile, then a 6-digit code. Opens over whatever the customer was doing. */
export function LoginSheet({ open, ...rest }: Props) {
  return open ? <Sheet {...rest} /> : null;
}

function Sheet({ api, onClose, onLoggedIn }: Omit<Props, 'open'>) {
  const { t } = useT();
  const c = t.c;
  const login = useOtpLogin(api, onLoggedIn);
  const { problem } = login;
  const message =
    problem &&
    loginMessage(problem, t.auth, {
      tooMany: t.errTooManyOtp,
      badCode: t.errBadCode,
      noDemoCode: t.errNoDemoCode,
      generic: t.errGeneric,
    });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (login.step === 'phone') login.sendCode();
    else login.verify();
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
          disabled={login.busy || (login.step === 'code' && login.code.length !== 6)}
        >
          {login.step === 'phone' ? c.loginSendCode : c.loginSubmit}
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
          value={login.phone}
          readOnly={login.step === 'code'}
          onChange={(event) => login.setPhone(event.target.value)}
        />
        {login.step === 'phone' && login.demo?.demo && problem?.kind !== 'demoMode' && (
          <DemoNumbers
            numbers={login.demo.numbers}
            selected={login.digits}
            onPick={login.setPhone}
          />
        )}
        {login.step === 'code' && (
          <>
            <Field
              label={c.loginCode}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={login.code}
              onChange={(event) => login.setCode(event.target.value.replace(/\D/g, ''))}
            />
            {/* OTP_MODE=simulated is the only mode (ADR-0013); this box goes with the inbox endpoint. */}
            <section className="cu-find__demo" aria-label={c.loginDemoTitle}>
              <p className="sh-label">{c.loginDemoTitle}</p>
              <p className="sh-helper">{c.loginDemoNote}</p>
              <Button variant="secondary" disabled={login.busy} onClick={login.fillDemoCode}>
                {c.loginDemoFill}
              </Button>
            </section>
            <Button variant="quiet" disabled={login.busy} onClick={login.resend}>
              {c.loginResend}
            </Button>
            <Button variant="quiet" disabled={login.busy} onClick={login.changeNumber}>
              {t.auth.changeNumber}
            </Button>
          </>
        )}
        {message && (
          <p className="sh-alert" role="alert">
            {message}
          </p>
        )}
        <p className="sh-helper">{c.loginPrivacy}</p>
      </form>
    </BottomSheet>
  );
}
