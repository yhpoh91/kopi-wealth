import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { config } from '../../config';

const isProd = config.stage === 'prod';
const appName = isProd ? 'Kopi Wealth' : 'Kopi Wealth Preview';

const manifest = JSON.stringify({
  name: appName,
  short_name: isProd ? 'Kopi Wealth' : 'KW Preview',
  description: 'Personal wealth OS — net worth, savings, investments, CPF',
  start_url: '/',
  display: 'standalone',
  background_color: '#1A3026',
  theme_color: '#1A3026',
  icons: [
    { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
  ],
});

export const handler: APIGatewayProxyHandlerV2 = async () => ({
  statusCode: 200,
  headers: { 'Content-Type': 'application/manifest+json' },
  body: manifest,
});
