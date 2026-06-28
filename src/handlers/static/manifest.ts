import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';

const manifest = JSON.stringify({
  name: 'kopi-wealth',
  short_name: 'kopi-wealth',
  start_url: '/',
  display: 'standalone',
  background_color: '#1A3026',
  theme_color: '#1A3026',
  icons: [
    { src: '/icon.png', sizes: '192x192', type: 'image/png' },
    { src: '/icon.png', sizes: '512x512', type: 'image/png' },
  ],
});

export const handler: APIGatewayProxyHandlerV2 = async () => ({
  statusCode: 200,
  headers: { 'Content-Type': 'application/manifest+json' },
  body: manifest,
});
