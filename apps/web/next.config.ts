import type { NextConfig } from 'next';
import { join } from 'node:path';

const apiUrl = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const nextConfig: NextConfig = {
  output: 'standalone',
  // 병렬 작업/검수용 별도 빌드 디렉터리 지원
  distDir: process.env.NEXT_DIST_DIR || '.next',
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@oogam/shared'],
  outputFileTracingRoot: join(__dirname, '../../'),
  images: { remotePatterns: [{ protocol: 'https', hostname: '**' }] },
  async rewrites() {
    // 브라우저는 항상 동일 출처(/api/v1)로 호출 → 쿠키가 1st-party 로 유지된다
    return [{ source: '/api/v1/:path*', destination: `${apiUrl}/api/v1/:path*` }];
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
