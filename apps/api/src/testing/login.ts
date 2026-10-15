import request from 'supertest';

type App = Parameters<typeof request>[0];

/** A real OTP login through the API, as a client does it. */
export async function loginAs(app: App, role: 'seeker' | 'shop', phone: string) {
  await request(app).post('/auth/otp/request').send({ phone });
  const inbox = await request(app).get('/dev/otp-inbox').query({ phone });
  const res = await request(app)
    .post('/auth/otp/verify')
    .send({ phone, code: inbox.body.code, role });
  return {
    token: res.body.token as string,
    userId: res.body.user.id as string,
    role: res.body.user.role as string,
  };
}
