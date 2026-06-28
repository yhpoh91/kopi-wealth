import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { requireSession } from '../lib/auth-middleware';
import { renderPage } from '../lib/layout';
import { getUser } from '../repositories/user';
import { getSettings, putSettings } from '../repositories/financialSettings';
import { escapeHtml } from '../lib/html';

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const auth = await requireSession(event);
  if (!auth.authenticated) return auth.redirect;

  const [user, settings] = await Promise.all([
    getUser(auth.session.sub),
    getSettings(auth.session.sub),
  ]);

  if (!settings) {
    const now = new Date().toISOString();
    await putSettings({
      PK: `SETTINGS#${auth.session.sub}`,
      SK: 'SETTINGS',
      sub: auth.session.sub,
      currency: 'SGD',
      timezone: 'Asia/Singapore',
      createdAt: now,
      updatedAt: now,
    });
  }

  const displayName = settings?.displayName ?? user?.name ?? user?.email ?? 'there';
  const currency = settings?.currency ?? 'SGD';

  const body = `
    <div style="max-width:640px;margin:0 auto">
      <h2 style="font-size:1.3rem;margin-bottom:1.5rem">
        Hello, ${escapeHtml(displayName)} 👋
      </h2>

      <div class="card" style="margin-bottom:1rem">
        <div style="font-size:0.8rem;color:var(--color-text-muted);margin-bottom:0.25rem">Net Worth</div>
        <div style="font-size:2rem;font-weight:700;color:var(--color-accent)">${escapeHtml(currency)} —</div>
        <div style="font-size:0.75rem;color:var(--color-text-muted);margin-top:0.25rem">Add accounts, investments and liabilities to get started</div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;margin-bottom:1rem">
        <div class="card">
          <div style="font-size:0.75rem;color:var(--color-text-muted)">Savings</div>
          <div style="font-size:1.2rem;font-weight:600;margin-top:0.25rem">—</div>
        </div>
        <div class="card">
          <div style="font-size:0.75rem;color:var(--color-text-muted)">Investments</div>
          <div style="font-size:1.2rem;font-weight:600;margin-top:0.25rem">—</div>
        </div>
      </div>

      <div class="card">
        <div style="font-size:0.85rem;color:var(--color-text-muted);text-align:center;padding:1rem 0">
          🚀 Your wealth dashboard is ready.<br>
          <a href="/accounts" style="color:var(--color-accent)">Add your first account</a> to get started.
        </div>
      </div>
    </div>`;

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html' },
    body: renderPage({
      title: 'Dashboard — kopi-wealth',
      body,
      page: 'dashboard',
      user: {
        sub: auth.session.sub,
        displayName: settings?.displayName,
        email: user?.email,
        role: auth.session.role,
      },
    }),
  };
};
