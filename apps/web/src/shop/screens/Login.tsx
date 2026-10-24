import type { FormEvent } from 'react';
import { BRAND_NAME } from '../../brand.js';
import { useT } from '../../i18n/index.js';
import { loginMessage, useOtpLogin, type LoginApi } from '../../lib/useOtpLogin.js';
import { BrandMark } from '../../ui/BrandMark.js';
import { Button } from '../../ui/Button.js';
import { DemoNumbers } from '../../ui/DemoNumbers.js';
import { Field } from '../../ui/Field.js';

export type { LoginApi };

interface Props {
  api: LoginApi;
  onLoggedIn: (token: string) => void;
}

/** Screen A: the brand at the top, the phone number at the bottom where the thumb is. */
export function Login({ api, onLoggedIn }: Props) {
  const { t } = useT();
  const s = t.shop;
  const login = useOtpLogin(api, onLoggedIn);
  const { problem } = login;
  const message =
    problem &&
    loginMessage(problem, t.auth, {
      tooMany: s.errTooMany,
      badCode: s.errBadCode,
      noDemoCode: s.errNoDemo,
      generic: s.errGeneric,
    });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (login.step === 'phone') login.sendCode();
    else login.verify();
  }

  return (
    <div className="sh-login">
      <header className="sh-login__brand">
        <BrandMark size={72} />
        <h1 className="sh-display">{BRAND_NAME}</h1>
        <p className="sh-body sh-muted">{s.forShops}</p>
      </header>

      <form className="sh-login__form" onSubmit={submit}>
        <Field
          label={s.mobileNumber}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          prefix="+91"
          value={login.phone}
          readOnly={login.step === 'code'}
          onChange={(event) => login.setPhone(event.target.value)}
        />

        {login.step === 'phone' ? (
          <>
            {login.demo?.demo && problem?.kind !== 'demoMode' && (
              <DemoNumbers
                numbers={login.demo.numbers}
                selected={login.digits}
                onPick={login.setPhone}
              />
            )}
            <Button type="submit" variant="primary" className="sh-btn--block" disabled={login.busy}>
              {s.sendCode}
            </Button>
          </>
        ) : (
          <>
            <Field
              label={s.codeLabel}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              helper={s.codeSentTo(login.digits ?? '')}
              value={login.code}
              onChange={(event) => login.setCode(event.target.value.replace(/\D/g, ''))}
            />
            {/* OTP_MODE=simulated is the only mode (ADR-0013); this box goes with the inbox endpoint. */}
            <section className="sh-demo" aria-label={s.demoTitle}>
              <p className="sh-label">{s.demoTitle}</p>
              <Button variant="secondary" disabled={login.busy} onClick={login.fillDemoCode}>
                {s.demoFill}
              </Button>
            </section>
            <Button
              type="submit"
              variant="primary"
              className="sh-btn--block"
              disabled={login.busy || login.code.length !== 6}
            >
              {s.verify}
            </Button>
            <Button variant="quiet" disabled={login.busy} onClick={login.resend}>
              {s.resend}
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
      </form>
    </div>
  );
}
