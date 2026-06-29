import { describe, it, expect } from 'vitest';
import { handler } from '../../../src/handlers/static/icon';

describe('GET /icon.svg', () => {
  it('returns 200 with SVG content type', async () => {
    const res = await handler({} as never, {} as never, () => {});
    expect(res).toMatchObject({ statusCode: 200, headers: { 'Content-Type': 'image/svg+xml' } });
  });

  it('returns valid SVG markup', async () => {
    const res = await handler({} as never, {} as never, () => {});
    const body = (res as { body: string }).body;
    expect(body).toContain('<svg');
    expect(body).toContain('viewBox="0 0 512 512"');
  });

  it('sets cache-control header', async () => {
    const res = await handler({} as never, {} as never, () => {});
    expect((res as { headers: Record<string, string> }).headers['Cache-Control']).toContain('max-age');
  });
});
