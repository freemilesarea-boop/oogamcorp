import type { NextConfig } from 'next';
import { join } from 'node:path';

// Vercel 에는 아직 백엔드가 없다 → 환경변수가 빠져도 정적(읽기 전용) 미리보기 모드로 안전하게 빌드한다.
// (fail-closed: /admin 404, /api 503, 검색 차단. 값을 명시하면 그 값이 우선. Docker 배포는 VERCEL 이 없어 영향 없음)
if (process.env.VERCEL) {
  process.env.NEXT_PUBLIC_DATA_SOURCE ||= 'static';
  process.env.NEXT_PUBLIC_SITE_MODE ||= 'preview';
}

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
  // CMS 모드 백엔드(NestJS·Prisma·argon2·sharp)는 번들하지 않고 런타임에 require (파일 추적으로 배포에 포함).
  // 워크스페이스 패키지는 serverExternalPackages 로 제외되지 않으므로 webpack externals 로 지정한다.
  webpack(config, { isServer }) {
    if (isServer) {
      const prev = config.externals ?? [];
      config.externals = [
        ...(Array.isArray(prev) ? prev : [prev]),
        ({ request }: { request?: string }, cb: (err?: Error | null, result?: string) => void) =>
          request === '@oogam/api/serverless' ? cb(null, 'commonjs @oogam/api/serverless') : cb(),
      ];
    }
    return config;
  },
  outputFileTracingIncludes: {
    '/**/*': ['../../node_modules/.pnpm/@prisma+client@*/node_modules/.prisma/client/**/*'],
  },
  outputFileTracingRoot: join(__dirname, '../../'),
  images: { remotePatterns: [{ protocol: 'https', hostname: '**' }] },
  async rewrites() {
    // 정적 사이트 모드(백엔드 없음)에서는 API 프록시를 만들지 않는다 (요청은 미들웨어가 503 으로 차단)
    if (process.env.NEXT_PUBLIC_DATA_SOURCE === 'static' || process.env.NEXT_PUBLIC_DATA_SOURCE === 'cms') return [];
    // 브라우저는 항상 동일 출처(/api/v1)로 호출 → 쿠키가 1st-party 로 유지된다
    return [{ source: '/api/v1/:path*', destination: `${apiUrl}/api/v1/:path*` }];
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
