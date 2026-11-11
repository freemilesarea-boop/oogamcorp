import 'server-only';

/**
 * 같은 배포 안의 홈페이지 CMS 백엔드(@oogam/api/serverless) 로더.
 * CMS 모드에서만 로드되며(정적·Docker 배포에서는 호출되지 않음), 서버 외부 패키지로 런타임에 require 된다.
 */
type Backend = typeof import('@oogam/api/serverless');

let backend: Promise<Backend> | null = null;

export function loadBackend(): Promise<Backend> {
  backend ??= import('@oogam/api/serverless').catch((e: unknown) => {
    backend = null;
    throw e;
  });
  return backend;
}
