import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

const sm = new SecretsManagerClient({ region: 'ap-southeast-1' });
const cache = new Map<string, { value: string; expiresAt: number }>();
const TTL_MS = 5 * 60 * 1000;

export async function getSecret(name: string): Promise<string> {
  const cached = cache.get(name);
  if (cached && Date.now() < cached.expiresAt) return cached.value;

  const res = await sm.send(new GetSecretValueCommand({ SecretId: name }));
  const value = res.SecretString ?? '';
  cache.set(name, { value, expiresAt: Date.now() + TTL_MS });
  return value;
}
