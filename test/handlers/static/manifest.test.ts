import { describe, it, expect, vi } from 'vitest';

describe('GET /manifest.json — preview stage', () => {
  it('uses "Kopi Wealth Preview" name and short_name', async () => {
    vi.resetModules();
    vi.doMock('../../../src/config', () => ({ config: { stage: 'preview' } }));
    const { handler } = await import('../../../src/handlers/static/manifest');
    const res = await handler({} as never, {} as never, () => {});
    const manifest = JSON.parse((res as { body: string }).body);
    expect(manifest.name).toBe('Kopi Wealth Preview');
    expect(manifest.short_name).toBe('KW Preview');
    vi.doUnmock('../../../src/config');
  });
});

describe('GET /manifest.json — prod stage', () => {
  it('uses "Kopi Wealth" name and short_name', async () => {
    vi.resetModules();
    vi.doMock('../../../src/config', () => ({ config: { stage: 'prod' } }));
    const { handler } = await import('../../../src/handlers/static/manifest');
    const res = await handler({} as never, {} as never, () => {});
    const manifest = JSON.parse((res as { body: string }).body);
    expect(manifest.name).toBe('Kopi Wealth');
    expect(manifest.short_name).toBe('Kopi Wealth');
    vi.doUnmock('../../../src/config');
  });
});

describe('GET /manifest.json — common fields', () => {
  it('returns 200 with manifest+json content type', async () => {
    vi.resetModules();
    vi.doMock('../../../src/config', () => ({ config: { stage: 'preview' } }));
    const { handler } = await import('../../../src/handlers/static/manifest');
    const res = await handler({} as never, {} as never, () => {});
    expect(res).toMatchObject({ statusCode: 200, headers: { 'Content-Type': 'application/manifest+json' } });
    vi.doUnmock('../../../src/config');
  });

  it('returns valid JSON with required fields', async () => {
    vi.resetModules();
    vi.doMock('../../../src/config', () => ({ config: { stage: 'preview' } }));
    const { handler } = await import('../../../src/handlers/static/manifest');
    const res = await handler({} as never, {} as never, () => {});
    const manifest = JSON.parse((res as { body: string }).body);
    expect(manifest).toMatchObject({ display: 'standalone', start_url: '/' });
    vi.doUnmock('../../../src/config');
  });

  it('includes SVG icons with any and maskable purposes', async () => {
    vi.resetModules();
    vi.doMock('../../../src/config', () => ({ config: { stage: 'preview' } }));
    const { handler } = await import('../../../src/handlers/static/manifest');
    const res = await handler({} as never, {} as never, () => {});
    const manifest = JSON.parse((res as { body: string }).body);
    const purposes = manifest.icons.map((i: { purpose: string }) => i.purpose);
    expect(purposes).toContain('any');
    expect(purposes).toContain('maskable');
    expect(manifest.icons.every((i: { src: string }) => i.src === '/icon.svg')).toBe(true);
    vi.doUnmock('../../../src/config');
  });
});
