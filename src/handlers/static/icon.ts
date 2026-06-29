import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';

// Maskable-safe: all meaningful content sits within the center 80% (safe zone)
// Background fills the full square so adaptive icon shapes (circle, squircle) look correct
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#1A3026"/>
  <!-- cup body -->
  <rect x="156" y="220" width="160" height="130" rx="18" ry="18" fill="#C7A052"/>
  <!-- cup handle -->
  <path d="M316 248 Q370 248 370 295 Q370 342 316 342" fill="none" stroke="#C7A052" stroke-width="22" stroke-linecap="round"/>
  <!-- saucer -->
  <ellipse cx="236" cy="362" rx="96" ry="14" fill="#A07838"/>
  <!-- steam lines -->
  <path d="M200 205 Q207 185 200 165" fill="none" stroke="#C7A052" stroke-width="10" stroke-linecap="round" opacity="0.7"/>
  <path d="M236 198 Q243 175 236 152" fill="none" stroke="#C7A052" stroke-width="10" stroke-linecap="round" opacity="0.7"/>
  <path d="M272 205 Q279 185 272 165" fill="none" stroke="#C7A052" stroke-width="10" stroke-linecap="round" opacity="0.7"/>
</svg>`.trim();

export const handler: APIGatewayProxyHandlerV2 = async () => ({
  statusCode: 200,
  headers: {
    'Content-Type': 'image/svg+xml',
    'Cache-Control': 'public, max-age=86400',
  },
  body: svg,
});
