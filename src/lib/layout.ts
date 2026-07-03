import layoutHtml from '../templates/layout.html';
import { escapeHtml } from './html';
import { config } from '../config';

const stageBadge = config.stage !== 'prod'
  ? ' <span style="font-size:0.5rem;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;background:rgba(199,160,82,0.15);border:1px solid rgba(199,160,82,0.45);color:var(--color-accent);border-radius:0.25rem;padding:0.1rem 0.35rem;vertical-align:middle;margin-left:0.3rem">PREVIEW</span>'
  : '';
const appleAppTitle = config.stage === 'prod' ? 'Kopi Wealth' : 'Kopi Wealth Preview';

export type NavPage = 'dashboard' | 'accounts' | 'investments' | 'goals' | 'cpf' | 'reserved-funds' | 'liabilities' | 'receivables' | 'expenses' | 'reports' | 'settings' | 'admin';

export interface LayoutOptions {
  title: string;
  body: string;
  page?: NavPage;
  headerLeft?: string;
  headerRight?: string;
  hideNav?: boolean;
  user?: {
    sub: string;
    displayName?: string;
    email?: string;
    role?: 'admin';
  };
}

export function renderPage(opts: LayoutOptions): string {
  const nav = (page: NavPage) => opts.page === page ? 'active' : '';

  const userPanel = opts.user ? buildAvatarBtn(opts.user) : '';
  const userPanelModal = opts.user ? buildUserModal(opts.user) : '';

  return layoutHtml
    .replace('{{TITLE}}', escapeHtml(opts.title))
    .replace('{{APPLE_APP_TITLE}}', appleAppTitle)
    .replace('{{STAGE_BADGE}}', stageBadge)
    .replace('{{BODY}}', opts.body)
    .replace('{{HEADER_LEFT}}', opts.headerLeft ?? '')
    .replace('{{HEADER_RIGHT}}', opts.headerRight ?? '')
    .replace('{{USER_PANEL}}', userPanel)
    .replace('{{USER_PANEL_MODAL}}', userPanelModal)
    .replace('{{HIDE_NAV}}', opts.hideNav ? 'hidden' : '')
    .replace('{{MAIN_CLASS}}', opts.hideNav ? 'no-nav' : '')
    .replace('{{NAV_DASHBOARD}}', nav('dashboard'))
    .replace('{{NAV_ACCOUNTS}}', nav('accounts'))
    .replace('{{NAV_INVESTMENTS}}', nav('investments'))
    .replace('{{NAV_MORE}}', ['cpf', 'reserved-funds', 'liabilities', 'receivables', 'expenses', 'reports', 'goals'].includes(opts.page ?? '') ? 'active' : '');
}

function initials(name: string): string {
  return name.trim().split(/\s+/).map((w) => w[0]).join('').toUpperCase().slice(0, 2);
}

function buildAvatarBtn(user: NonNullable<LayoutOptions['user']>): string {
  const label = user.displayName ?? user.email ?? user.sub;
  return `<button class="avatar-btn" onclick="openPanel()" aria-label="Open user menu">${escapeHtml(initials(label))}</button>`;
}

function buildUserModal(user: NonNullable<LayoutOptions['user']>): string {
  const label = user.displayName ?? user.email ?? user.sub;
  const emailLine = user.email ? `<div class="panel-email">${escapeHtml(user.email)}</div>` : '';
  return `
  <div class="panel-overlay" id="user-overlay" onclick="closePanel()">
    <div class="panel-sheet" onclick="event.stopPropagation()">
      <div class="panel-header">
        <div class="panel-avatar">${escapeHtml(initials(label))}</div>
        <div>
          <div class="panel-name">${escapeHtml(label)}</div>
          ${emailLine}
        </div>
      </div>
      <button class="panel-row" id="theme-btn" onclick="toggleTheme()">☀️ Light mode</button>
      <a href="/settings" class="panel-row" onclick="closePanel()">⚙️ Settings</a>
      <form method="POST" action="/auth/logout" style="display:contents">
        <button type="submit" class="panel-row danger">Sign out</button>
      </form>
    </div>
  </div>`;
}
