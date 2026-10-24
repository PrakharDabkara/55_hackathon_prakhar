import { indianMobile } from '@askbuy/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, type DemoNumbers, type ShopApi } from './api.js';

/** What went wrong on a login screen; the screen turns it into words. */
export type LoginProblem =
  | { kind: 'badPhone' | 'tooMany' | 'demoMode' | 'noDemoCode' | 'generic' }
  | { kind: 'badCode'; attemptsLeft: number | null };

export type LoginApi = Pick<ShopApi, 'requestOtp' | 'devInbox' | 'verifyOtp' | 'demoNumbers'>;

/** Marks the history entry the code step pushed, so the browser's back button can undo the step. */
const STEP_MARK = 'askbuyOtpStep';

function problemOf(error: unknown): LoginProblem {
  if (error instanceof ApiError) {
    if (error.code === 'demo_mode') return { kind: 'demoMode' };
    if (error.status === 429) return { kind: 'tooMany' };
    if (error.code === 'invalid_code') {
      const left = error.details['attemptsLeft'];
      return { kind: 'badCode', attemptsLeft: typeof left === 'number' ? left : null };
    }
    if (error.status === 400) return { kind: 'badPhone' };
  }
  return { kind: 'generic' };
}

/**
 * The login flow both apps share: a mobile number, then a 6-digit code. Owns the steps, the demo
 * numbers, and the rules that a wrong code stays on screen until the code is edited, and that
 * "Change number" and the browser's back button both return to a clean number step.
 */
export function useOtpLogin(api: LoginApi, onLoggedIn: (token: string) => void) {
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhoneState] = useState('');
  const [code, setCodeState] = useState('');
  const [problem, setProblem] = useState<LoginProblem | null>(null);
  const [busy, setBusy] = useState(false);
  const [demo, setDemo] = useState<DemoNumbers | null>(null);
  const stepRef = useRef(step);
  stepRef.current = step;

  const digits = indianMobile(phone);

  useEffect(() => {
    let alive = true;
    api.demoNumbers().then(
      (found) => alive && setDemo(found),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [api]);

  const backToNumber = useCallback(() => {
    setStep('phone');
    setCodeState('');
    setProblem(null);
  }, []);

  useEffect(() => {
    const onPop = () => {
      if (stepRef.current === 'code') backToNumber();
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [backToNumber]);

  async function run(work: () => Promise<void>) {
    setBusy(true);
    try {
      await work();
    } catch (error) {
      setProblem(problemOf(error));
    } finally {
      setBusy(false);
    }
  }

  return {
    step,
    phone,
    code,
    problem,
    busy,
    demo,
    digits,
    setPhone(next: string) {
      setPhoneState(next);
      setProblem(null);
    },
    /** Editing the code is what clears a wrong-code message. */
    setCode(next: string) {
      setCodeState(next);
      setProblem(null);
    },
    sendCode() {
      if (!digits) {
        setProblem({ kind: 'badPhone' });
        return;
      }
      setProblem(null);
      void run(async () => {
        await api.requestOtp(digits);
        setCodeState('');
        setStep('code');
        window.history.pushState(
          { ...(window.history.state as object | null), [STEP_MARK]: 1 },
          '',
        );
      });
    },
    resend() {
      if (!digits) return;
      setProblem(null);
      void run(() => api.requestOtp(digits));
    },
    /** A wrong code leaves its message up while the next try runs; only editing the code clears it. */
    verify() {
      if (!digits) return;
      void run(async () => {
        const { token } = await api.verifyOtp(digits, code);
        onLoggedIn(token);
      });
    },
    fillDemoCode() {
      if (!digits) return;
      setProblem(null);
      void run(async () => {
        const found = await api.devInbox(digits);
        if (found === null) setProblem({ kind: 'noDemoCode' });
        else setCodeState(found);
      });
    },
    changeNumber() {
      backToNumber();
      // Take the entry the code step pushed off the history, so Back does not land on it again.
      if ((window.history.state as Record<string, unknown> | null)?.[STEP_MARK]) {
        window.history.back();
      }
    },
  };
}

/** The words for a problem. The app's own copy covers what differs; the shared copy the rest. */
export function loginMessage(
  problem: LoginProblem,
  auth: { badPhone: string; demoNotice: string; triesLeft: (n: number) => string },
  own: { tooMany: string; badCode: string; noDemoCode: string; generic: string },
): string {
  switch (problem.kind) {
    case 'badPhone':
      return auth.badPhone;
    case 'demoMode':
      return auth.demoNotice;
    case 'tooMany':
      return own.tooMany;
    case 'noDemoCode':
      return own.noDemoCode;
    case 'badCode':
      return problem.attemptsLeft === null
        ? own.badCode
        : `${own.badCode} ${auth.triesLeft(problem.attemptsLeft)}`;
    case 'generic':
      return own.generic;
  }
}
