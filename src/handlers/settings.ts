import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { requireSession } from '../lib/auth-middleware';
import { renderPage } from '../lib/layout';
import { getUser } from '../repositories/user';
import { getSettings, putSettings } from '../repositories/financialSettings';
import { escapeHtml } from '../lib/html';

const CURRENCIES = ['SGD', 'USD', 'MYR', 'AUD', 'GBP', 'EUR', 'JPY', 'HKD'];
const TIMEZONES = ['Asia/Singapore', 'Asia/Kuala_Lumpur', 'Australia/Sydney', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'Asia/Tokyo', 'Asia/Hong_Kong'];

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const auth = await requireSession(event);
  if (!auth.authenticated) return auth.redirect;

  const [user, settings] = await Promise.all([
    getUser(auth.session.sub),
    getSettings(auth.session.sub),
  ]);

  if (event.requestContext.http.method === 'POST') {
    const body = Object.fromEntries(
      new URLSearchParams(event.body ?? '').entries(),
    );

    const displayName = (body.displayName ?? '').trim().slice(0, 100) || undefined;
    const currency = CURRENCIES.includes(body.currency) ? body.currency : 'SGD';
    const timezone = TIMEZONES.includes(body.timezone) ? body.timezone : 'Asia/Singapore';
    const now = new Date().toISOString();

    await putSettings({
      PK: `SETTINGS#${auth.session.sub}`,
      SK: 'SETTINGS',
      sub: auth.session.sub,
      displayName,
      currency,
      timezone,
      createdAt: settings?.createdAt ?? now,
      updatedAt: now,
    });

    return {
      statusCode: 302,
      headers: { Location: '/settings' },
      cookies: [],
      body: '',
    };
  }

  const displayName = settings?.displayName ?? '';
  const currency = settings?.currency ?? 'SGD';
  const timezone = settings?.timezone ?? 'Asia/Singapore';

  const currencyOptions = CURRENCIES.map(
    (c) => `<option value="${c}"${c === currency ? ' selected' : ''}>${escapeHtml(c)}</option>`,
  ).join('');

  const timezoneOptions = TIMEZONES.map(
    (tz) => `<option value="${escapeHtml(tz)}"${tz === timezone ? ' selected' : ''}>${escapeHtml(tz)}</option>`,
  ).join('');

  const body = `
    <div style="max-width:480px;margin:0 auto">
      <h2 style="font-size:1.3rem;margin-bottom:1.5rem">Settings</h2>

      <form method="POST" action="/settings">
        <div class="card" style="margin-bottom:1rem">
          <h3 style="font-size:0.95rem;font-weight:600;margin-bottom:1rem">Profile</h3>
          <div class="form-group">
            <label for="displayName">Display Name</label>
            <input id="displayName" name="displayName" type="text" value="${escapeHtml(displayName)}" placeholder="${escapeHtml(user?.name ?? user?.email ?? '')}">
          </div>
        </div>

        <div class="card" style="margin-bottom:1.5rem">
          <h3 style="font-size:0.95rem;font-weight:600;margin-bottom:1rem">Preferences</h3>
          <div class="form-group">
            <label for="currency">Currency</label>
            <select id="currency" name="currency">${currencyOptions}</select>
          </div>
          <div class="form-group" style="margin-bottom:0">
            <label for="timezone">Timezone</label>
            <select id="timezone" name="timezone">${timezoneOptions}</select>
          </div>
        </div>

        <button type="submit" class="btn-primary" style="width:100%">Save Settings</button>
      </form>
    </div>`;

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html' },
    body: renderPage({
      title: 'Settings — kopi-wealth',
      body,
      page: 'settings',
      user: {
        sub: auth.session.sub,
        displayName: settings?.displayName,
        email: user?.email,
        role: auth.session.role,
      },
    }),
  };
};
