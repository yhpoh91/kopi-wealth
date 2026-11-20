import { config } from '../config';

// Cached per return URL; web callers omit it and get `${appUrl}/` as always.
const cache = new Map<string, string>();

export async function getAccountManagementUrl(returnUrl = `${config.appUrl}/`): Promise<string> {
  const hit = cache.get(returnUrl);
  if (hit !== undefined) return hit;
  const result = await fetchAccountManagementUrl(returnUrl);
  cache.set(returnUrl, result);
  return result;
}

async function fetchAccountManagementUrl(returnUrl: string): Promise<string> {
  if (!config.ssoIssuer) return '';
  try {
    const res = await fetch(`${config.ssoIssuer}/.well-known/openid-configuration`);
    if (!res.ok) return '';
    const doc = await res.json() as Record<string, unknown>;
    if (typeof doc.account_management_uri !== 'string' || !doc.account_management_uri) {
      return '';
    }
    const url = new URL(doc.account_management_uri);
    if (config.ssoClientId) url.searchParams.set('client_id', config.ssoClientId);
    url.searchParams.set('return_url', returnUrl);
    return url.toString();
  } catch {
    return '';
  }
}

export function resetAccountManagementCache(): void {
  cache.clear();
}
