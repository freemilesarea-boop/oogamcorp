import { BadRequestException, Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import type { AuthContext } from '../../common/auth/auth.types';
import { AllowMfaStage, CurrentUser } from '../../common/auth/decorators';
import { reqMeta } from '../../common/utils/request';
import { loadConfig } from '../../config/configuration';
import { MfaCodeDto, MfaPasswordDto, MfaSensitiveDto, MfaVerifyDto } from './auth.dto';
import { MfaService } from './mfa.service';

const limit = (n: number) => () => (loadConfig().env === 'test' ? 10_000 : n);

@ApiTags('Authentication')
@Controller('auth/mfa')
export class MfaController {
  constructor(private readonly mfa: MfaService) {}

  @AllowMfaStage('enroll')
  @Get()
  status(@CurrentUser() u: AuthContext) {
    return this.mfa.status(u);
  }

  /** 등록 시작: 비밀번호 재확인 후 TOTP 비밀키 + QR 반환 (확인 전까지 미적용) */
  @AllowMfaStage('enroll')
  @Throttle({ default: { limit: limit(10), ttl: 60_000 } })
  @Post('enroll/start')
  @HttpCode(200)
  start(@CurrentUser() u: AuthContext, @Body() dto: MfaPasswordDto) {
    return this.mfa.startEnrollment(u, dto.password);
  }

  /** 등록 확인: 첫 코드 검증 → 활성화 + 복구 코드 10개(1회만 표시) */
  @AllowMfaStage('enroll')
  @Throttle({ default: { limit: limit(10), ttl: 60_000 } })
  @Post('enroll/confirm')
  @HttpCode(200)
  confirm(@CurrentUser() u: AuthContext, @Body() dto: MfaCodeDto) {
    return this.mfa.confirmEnrollment(u, dto.code);
  }

  /** 로그인 후 2단계 검증 */
  @AllowMfaStage('pending')
  @Throttle({ default: { limit: limit(10), ttl: 60_000 } })
  @Post('verify')
  @HttpCode(200)
  verify(@CurrentUser() u: AuthContext, @Body() dto: MfaVerifyDto, @Req() req: Request) {
    if (!dto.code === !dto.recoveryCode) throw new BadRequestException('인증 코드 또는 복구 코드 중 하나를 입력하세요.');
    return this.mfa.verify(u, dto, reqMeta(req));
  }

  @Post('disable')
  @HttpCode(200)
  disable(@CurrentUser() u: AuthContext, @Body() dto: MfaSensitiveDto) {
    return this.mfa.disable(u, dto.password, dto.code);
  }

  @Post('recovery-codes')
  @HttpCode(200)
  regenerate(@CurrentUser() u: AuthContext, @Body() dto: MfaSensitiveDto) {
    return this.mfa.regenerateRecoveryCodes(u, dto.password, dto.code);
  }

  /** 최고관리자의 타 사용자 MFA 초기화 (기기 분실 대응) */
  @Post('reset/:userId')
  @HttpCode(200)
  reset(@CurrentUser() u: AuthContext, @Param('userId', ParseUUIDPipe) userId: string) {
    return this.mfa.adminReset(u, userId);
  }
}
