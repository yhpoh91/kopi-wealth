import { describe, it, expect } from 'vitest';
import { escapeHtml } from '../../src/lib/html';

describe('escapeHtml', () => {
  it('escapes ampersand', () => expect(escapeHtml('a&b')).toBe('a&amp;b'));
  it('escapes less-than', () => expect(escapeHtml('<tag>')).toBe('&lt;tag&gt;'));
  it('escapes double quote', () => expect(escapeHtml('"val"')).toBe('&quot;val&quot;'));
  it('escapes single quote', () => expect(escapeHtml("it's")).toBe('it&#39;s'));
  it('returns plain strings unchanged', () => expect(escapeHtml('hello')).toBe('hello'));
  it('escapes multiple special chars', () => {
    expect(escapeHtml('<a href="x&y">it\'s</a>')).toBe(
      '&lt;a href=&quot;x&amp;y&quot;&gt;it&#39;s&lt;/a&gt;',
    );
  });
});
