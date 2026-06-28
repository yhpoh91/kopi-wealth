import { describe, it, expect } from 'vitest';
import { renderPage } from '../../src/lib/layout';

describe('renderPage', () => {
  it('injects title', () => {
    const html = renderPage({ title: 'Test Page', body: '' });
    expect(html).toContain('<title>Test Page</title>');
  });

  it('injects body', () => {
    const html = renderPage({ title: 'T', body: '<p>Hello</p>' });
    expect(html).toContain('<p>Hello</p>');
  });

  it('marks active nav item', () => {
    const html = renderPage({ title: 'T', body: '', page: 'dashboard' });
    expect(html).toContain('class="nav-item active"');
  });

  it('no active class when page does not match', () => {
    const html = renderPage({ title: 'T', body: '', page: 'accounts' });
    expect(html).toContain('class="nav-item active"');
  });

  it('hides nav when hideNav is true', () => {
    const html = renderPage({ title: 'T', body: '', hideNav: true });
    expect(html).toContain('bottom-nav hidden');
    expect(html).toContain('class="no-nav"');
  });

  it('shows nav by default', () => {
    const html = renderPage({ title: 'T', body: '' });
    expect(html).not.toContain('bottom-nav hidden');
  });

  it('renders user avatar button when user provided', () => {
    const html = renderPage({ title: 'T', body: '', user: { sub: 'sub1', displayName: 'Alice Brown' } });
    expect(html).toContain('onclick="openPanel()"');
    expect(html).toContain('AB');
  });

  it('renders initials from displayName', () => {
    const html = renderPage({ title: 'T', body: '', user: { sub: 's', displayName: 'John Doe' } });
    expect(html).toContain('JD');
  });

  it('renders user modal with email', () => {
    const html = renderPage({ title: 'T', body: '', user: { sub: 's', email: 'x@y.com', displayName: 'XY' } });
    expect(html).toContain('x@y.com');
    expect(html).toContain('panel-overlay');
  });

  it('no user panel when user not provided', () => {
    const html = renderPage({ title: 'T', body: '' });
    expect(html).not.toContain('onclick="openPanel()"');
  });

  it('renders user modal without email element when no email', () => {
    const html = renderPage({ title: 'T', body: '', user: { sub: 'sub1', displayName: 'Alice' } });
    expect(html).not.toContain('class="panel-email"');
  });

  it('falls back to sub for avatar label when no name or email', () => {
    const html = renderPage({ title: 'T', body: '', user: { sub: 'mysub' } });
    expect(html).toContain('onclick="openPanel()"');
  });

  it('escapes title special chars', () => {
    const html = renderPage({ title: '<b>X</b>', body: '' });
    expect(html).toContain('&lt;b&gt;X&lt;/b&gt;');
  });

  it('injects headerLeft and headerRight', () => {
    const html = renderPage({ title: 'T', body: '', headerLeft: 'LEFT', headerRight: 'RIGHT' });
    expect(html).toContain('LEFT');
    expect(html).toContain('RIGHT');
  });
});
