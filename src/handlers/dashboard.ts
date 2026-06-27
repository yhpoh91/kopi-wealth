import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';

export const handler: APIGatewayProxyHandlerV2 = async () => ({
  statusCode: 200,
  headers: { 'Content-Type': 'text/html' },
  body: '<h1>kopi-wealth</h1><p>Coming soon.</p>',
});
