type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * The demo OTP flow (ADR-0004, ADR-0013: OTP_MODE=simulated): ask for a code, read it from the demo
 * inbox, verify it as a seeker. Returns the session token and nothing else; the caller must never
 * print it.
 */
export async function loginWithDemoOtp({
  apiUrl,
  phone,
  fetch: fetchImpl = (url, init) => fetch(url, init),
}: {
  apiUrl: string;
  phone: string;
  fetch?: FetchLike;
}): Promise<string> {
  const root = apiUrl.replace(/\/+$/, '');
  const post = (path: string, body: unknown) =>
    fetchImpl(`${root}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  const requested = await post('/auth/otp/request', { phone });
  if (requested.status === 429) {
    throw new Error('Too many code requests for this number. Try again in a few minutes.');
  }
  if (!requested.ok) throw new Error(`The API refused the number (status ${requested.status}).`);

  const inbox = await fetchImpl(`${root}/dev/otp-inbox?phone=${encodeURIComponent(phone)}`);
  const code = inbox.ok ? ((await inbox.json()) as { code?: string }).code : undefined;
  if (!code) {
    throw new Error('No demo code available: this server may not be in demo OTP mode.');
  }

  const verified = await post('/auth/otp/verify', { phone, code, role: 'seeker' });
  if (!verified.ok) {
    throw new Error(
      verified.status === 409 || verified.status === 403
        ? 'This number belongs to a shop. Use a different number for the customer login.'
        : `Login failed (status ${verified.status}).`,
    );
  }
  const { token } = (await verified.json()) as { token?: string };
  if (!token) throw new Error('Login failed: the API sent no session.');
  return token;
}
