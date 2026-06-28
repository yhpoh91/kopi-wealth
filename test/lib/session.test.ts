import { describe, it, expect } from 'vitest';
import { parseCookies, setCookieHeader, clearCookieHeader } from '../../src/lib/session';

describe('parseCookies', () => {
  it('parses multiple cookies', () => {
    const result = parseCookies('sid=abc123; foo=bar');
    expect(result).toEqual({ sid: 'abc123', foo: 'bar' });
  });

  it('returns empty object for undefined', () => {
    expect(parseCookies(undefined)).toEqual({});
  });

  it('decodes URI-encoded values', () => {
    const result = parseCookies('return_to=%2Fdashboard');
    expect(result.return_to).toBe('/dashboard');
  });

  it('handles values with = signs', () => {
    const result = parseCookies('token=abc=def=ghi');
    expect(result.token).toBe('abc=def=ghi');
  });
});

describe('setCookieHeader', () => {
  it('builds a secure HttpOnly cookie string', () => {
    const header = setCookieHeader('sid', 'abc', 86400, true);
    expect(header).toContain('sid=abc');
    expect(header).toContain('Max-Age=86400');
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Lax');
    expect(header).toContain('Secure');
  });

  it('omits Secure flag when not secure', () => {
    const header = setCookieHeader('sid', 'abc', 600, false);
    expect(header).not.toContain('Secure');
  });

  it('URI-encodes special characters in value', () => {
    const header = setCookieHeader('return_to', '/foo?a=1', 600, false);
    expect(header).toContain(encodeURIComponent('/foo?a=1'));
  });
});

describe('clearCookieHeader', () => {
  it('sets Max-Age=0', () => {
    const header = clearCookieHeader('sid');
    expect(header).toContain('sid=');
    expect(header).toContain('Max-Age=0');
  });
});
