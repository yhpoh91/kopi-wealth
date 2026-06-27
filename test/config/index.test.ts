import { describe, it, expect } from 'vitest';
import { secretName } from '../../src/config';

describe('config', () => {
  it('builds secret name with stage prefix', () => {
    expect(secretName('sso-client-secret')).toMatch(/^wealth\/.*\/sso-client-secret$/);
  });
});
