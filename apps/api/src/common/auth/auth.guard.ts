import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PermissionKey } from '@oogam/shared';
import { loadConfig } from '../../config/configuration';
import type { AuthedRequest } from './auth.types';
import { IS_PUBLIC_KEY, MFA_STAGE_KEY, PERMISSIONS_KEY, SKIP_CSRF_KEY } from './decorators';
import { SessionService } from './session.service';
import { safeEqual } from './tokens';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * 전역 가드: 세션 인증 → Origin 검사 → CSRF 동기화 토큰 검사 → 권한 검사.
 * 프런트엔드의 메뉴 숨김과 무관하게 모든 API 요청에서 서버가 강제한다.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly cfg = loadConfig();

  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const targets = [context.getHandler(), context.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets) ?? false;
    const skipCsrf = this.reflector.getAllAndOverride<boolean>(SKIP_CSRF_KEY, targets) ?? false;
    const mutating = !SAFE_METHODS.has(req.method);

    // 1) Origin 검사 (교차 출처 쓰기 요청 차단)
    if (mutating) this.checkOrigin(req);

    // 2) 세션 확인 (공개 엔드포인트도 세션이 있으면 컨텍스트를 채운다)
    const token = req.cookies?.[this.cfg.cookie.sessionName] as string | undefined;
    if (token) {
      const auth = await this.sessions.resolve(token);
      if (auth) req.auth = auth;
    }
    if (!req.auth) {
      if (isPublic) return true;
      throw new UnauthorizedException('로그인이 필요합니다.');
    }

    // 3) CSRF — 인증된 세션의 모든 상태 변경 요청
    if (mutating && !skipCsrf) {
      const header = req.header('x-csrf-token') ?? '';
      if (!header || !safeEqual(header, req.auth.csrfToken)) {
        throw new ForbiddenException('CSRF 토큰이 유효하지 않습니다.');
      }
    }

    // 4) MFA — 검증 전 세션/등록 필수 미등록 세션은 허용된 엔드포인트 외 차단 (공개 엔드포인트 포함 관리자 API 전체)
    const stage = this.reflector.getAllAndOverride<'pending' | 'enroll'>(MFA_STAGE_KEY, targets);
    if (req.auth.mfa.enabled && !req.auth.mfa.verified) {
      if (stage !== 'pending' && !isPublic) {
        throw new UnauthorizedException({ statusCode: 401, code: 'MFA_REQUIRED', message: '2단계 인증(MFA)을 완료해야 합니다.' });
      }
    } else if (req.auth.mfa.required && !req.auth.mfa.enabled) {
      if (!stage && !isPublic) {
        throw new ForbiddenException({ statusCode: 403, code: 'MFA_ENROLLMENT_REQUIRED', message: '이 계정은 2단계 인증(MFA) 등록이 필요합니다.' });
      }
    }

    // 5) 권한
    const required = this.reflector.getAllAndOverride<PermissionKey[]>(PERMISSIONS_KEY, targets) ?? [];
    if (!isPublic && !req.auth.permissions.has('workspace.access')) {
      throw new ForbiddenException('워크스페이스 접근 권한이 없습니다.');
    }
    for (const p of required) {
      if (!req.auth.permissions.has(p)) throw new ForbiddenException('이 작업에 대한 권한이 없습니다.');
    }
    return true;
  }

  private checkOrigin(req: AuthedRequest): void {
    const origin = req.header('origin');
    if (!origin) return; // 동일 출처 서버 간 호출/비브라우저 클라이언트는 쿠키+CSRF 로 보호
    const host = req.header('x-forwarded-host') ?? req.header('host');
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      throw new ForbiddenException('잘못된 Origin');
    }
    if (originHost === host) return;
    if (this.cfg.webOrigins.includes(origin)) return;
    throw new ForbiddenException('허용되지 않은 출처의 요청입니다.');
  }
}
