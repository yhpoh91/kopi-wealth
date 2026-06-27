export const config = {
  stage: process.env.STAGE ?? 'preview',
  tableName: process.env.TABLE_NAME ?? 'wealth-preview-data',
  appUrl: process.env.STAGE === 'prod' ? 'https://wealth.kopi.life' : 'https://wealth-preview.kopi.life',
  ssoIssuer: process.env.SSO_ISSUER ?? '',
  ssoClientId: process.env.SSO_CLIENT_ID ?? '',
  adminSub: process.env.ADMIN_SUB ?? '',
  // Sensitive secrets fetched at runtime from Secrets Manager via src/lib/secrets.ts
  // Secret paths: wealth/${stage}/sso-client-secret
};

export function secretName(key: string): string {
  return `wealth/${config.stage}/${key}`;
}
