import { describe, it, expect } from 'vitest';
import { handler } from '../../../src/handlers/static/service-worker';

describe('GET /service-worker.js', () => {
  it('returns 200 with javascript content type', async () => {
    const res = await handler({} as never, {} as never, () => {});
    expect(res).toMatchObject({ statusCode: 200, headers: { 'Content-Type': 'application/javascript' } });
  });

  it('body contains fetch event listener', async () => {
    const res = await handler({} as never, {} as never, () => {});
    expect((res as { body: string }).body).toContain("addEventListener('fetch'");
  });
});
