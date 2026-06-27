import { describe, it, expect } from 'vitest';
import { handler } from '../../src/handlers/dashboard';

describe('GET /', () => {
  it('returns 200 with HTML body', async () => {
    const res = await handler({} as never, {} as never, () => {});
    expect(res).toMatchObject({ statusCode: 200, headers: { 'Content-Type': 'text/html' } });
    expect((res as { body: string }).body).toContain('kopi-wealth');
  });
});
