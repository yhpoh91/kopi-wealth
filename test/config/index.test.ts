import { describe, it, expect, vi } from 'vitest';
import { secretName, config } from '../../src/config';

describe('config', () => {
  it('builds secret name with stage prefix', () => {
    expect(secretName('sso-client-secret')).toMatch(/^wealth\/.*\/sso-client-secret$/);
  });

  it('uses preview app URL by default', () => {
    expect(config.appUrl).toBe('https://wealth-preview.kopi.life');
  });

  it('uses prod app URL when STAGE=prod', async () => {
    vi.stubEnv('STAGE', 'prod');
    vi.resetModules();
    const { config: prodConfig } = await import('../../src/config');
    expect(prodConfig.appUrl).toBe('https://wealth.kopi.life');
    vi.unstubAllEnvs();
    vi.resetModules();
  });
});
