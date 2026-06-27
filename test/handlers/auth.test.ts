import { describe, it, expect } from 'vitest';
import { handler as loginHandler } from '../../src/handlers/auth/login';
import { handler as callbackHandler } from '../../src/handlers/auth/callback';
import { handler as logoutHandler } from '../../src/handlers/auth/logout';

describe('auth stub handlers', () => {
  it('login redirects to /', async () => {
    const res = await loginHandler({} as never, {} as never, () => {});
    expect(res).toMatchObject({ statusCode: 302, headers: { Location: '/' } });
  });

  it('callback redirects to /', async () => {
    const res = await callbackHandler({} as never, {} as never, () => {});
    expect(res).toMatchObject({ statusCode: 302, headers: { Location: '/' } });
  });

  it('logout redirects to /', async () => {
    const res = await logoutHandler({} as never, {} as never, () => {});
    expect(res).toMatchObject({ statusCode: 302, headers: { Location: '/' } });
  });
});
