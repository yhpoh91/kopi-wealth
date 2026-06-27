import { describe, it, expect } from 'vitest';
import { handler } from '../../src/handlers/health';

describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    const res = await handler({} as never, {} as never, () => {});
    expect(res).toMatchObject({ statusCode: 200 });
    expect(JSON.parse((res as { body: string }).body)).toEqual({ status: 'ok' });
  });
});
