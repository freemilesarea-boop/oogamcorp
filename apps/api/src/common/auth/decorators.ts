import { createParamDecorator, ExecutionContext, SetMetadata, UnauthorizedException } from '@nestjs/common';
import type { PermissionKey } from '@oogam/shared';
import type { AuthContext, AuthedRequest } from './auth.types';

export const IS_PUBLIC_KEY = 'oogam:isPublic';
export const PERMISSIONS_KEY = 'oogam:permissions';
export const SKIP_CSRF_KEY = 'oogam:skipCsrf';

/** 인증 없이 접근 가능한 엔드포인트 (공개 홈페이지 API, 로그인 등) */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** 지정한 모든 권한이 필요하다 (AND). 서버 측 강제 */
export const RequirePermissions = (...perms: PermissionKey[]) => SetMetadata(PERMISSIONS_KEY, perms);

/** 세션이 없는 공개 POST(로그인/문의)에만 사용. Origin 검사는 여전히 적용된다 */
export const SkipCsrf = () => SetMetadata(SKIP_CSRF_KEY, true);

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthContext => {
  const req = ctx.switchToHttp().getRequest<AuthedRequest>();
  if (!req.auth) throw new UnauthorizedException('로그인이 필요합니다.');
  return req.auth;
});
