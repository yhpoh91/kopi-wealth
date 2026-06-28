import { describe, it, expect } from 'vitest';
import { handler } from '../../../src/handlers/static/manifest';

describe('GET /manifest.json', () => {
  it('returns 200 with manifest+json content type', async () => {
    const res = await handler({} as never, {} as never, () => {});
    expect(res).toMatchObject({ statusCode: 200, headers: { 'Content-Type': 'application/manifest+json' } });
  });

  it('returns valid JSON with required fields', async () => {
    const res = await handler({} as never, {} as never, () => {});
    const manifest = JSON.parse((res as { body: string }).body);
    expect(manifest).toMatchObject({
      name: 'kopi-wealth',
      short_name: 'kopi-wealth',
      display: 'standalone',
    });
  });
});
