import { config } from '../config';

let cachedUrl: string | null = null;

export async function getAccountManagementUrl(): Promise<string> {
  if (cachedUrl !== null) return cachedUrl;
  if (!config.ssoIssuer) return (cachedUrl = '');
  try {
    const res = await fetch(`${config.ssoIssuer}/.well-known/openid-configuration`);
    if (!res.ok) return (cachedUrl = '');
    const doc = await res.json() as Record<string, unknown>;
    if (typeof doc.account_management_uri !== 'string' || !doc.account_management_uri) {
      return (cachedUrl = '');
    }
    const url = new URL(doc.account_management_uri);
    if (config.ssoClientId) url.searchParams.set('client_id', config.ssoClientId);
    url.searchParams.set('return_url', `${config.appUrl}/`);
    cachedUrl = url.toString();
  } catch {
    cachedUrl = '';
  }
  return cachedUrl;
}

export function resetAccountManagementCache(): void {
  cachedUrl = null;
}
