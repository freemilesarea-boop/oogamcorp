import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthContext } from '../../common/auth/auth.types';
import { CurrentUser, Public, SkipCsrf } from '../../common/auth/decorators';
import { SessionService } from '../../common/auth/session.service';
import { reqMeta } from '../../common/utils/request';
import { AcceptInvitationDto, ChangePasswordDto, LoginDto } from './auth.dto';
import { AuthService } from './auth.service';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  /** 로그인 (IP 당 분당 10회 제한 + 계정 단위 실패 잠금) */
  @Public()
  @SkipCsrf()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { token, csrfToken, mfaRequired } = await this.auth.login(dto.email, dto.password, reqMeta(req));
    this.sessions.setCookies(res, token, csrfToken);
    return { ok: true, csrfToken, mfaRequired };
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@CurrentUser() user: AuthContext, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.sessions.revoke(user.sessionId);
    await this.audit.forUser(user, 'auth.logout', reqMeta(req));
    this.sessions.clearCookies(res);
    return { ok: true };
  }

  @Get('me')
  me(@CurrentUser() user: AuthContext) {
    return this.auth.me(user);
  }

  @Post('change-password')
  @HttpCode(200)
  async changePassword(@CurrentUser() user: AuthContext, @Body() dto: ChangePasswordDto) {
    await this.auth.changePassword(user, dto.currentPassword, dto.newPassword);
    return { ok: true };
  }

  @Get('sessions')
  sessionsList(@CurrentUser() user: AuthContext) {
    return this.auth.listSessions(user);
  }

  @Delete('sessions/:id')
  revoke(@CurrentUser() user: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.auth.revokeSession(user, id);
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get('invitation')
  invitation(@Query('token') token: string) {
    return this.auth.invitationInfo(String(token ?? ''));
  }

  @Public()
  @SkipCsrf()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('accept-invitation')
  @HttpCode(200)
  async accept(@Body() dto: AcceptInvitationDto, @Req() req: Request) {
    await this.auth.acceptInvitation(dto.token, dto.name, dto.password, reqMeta(req));
    return { ok: true };
  }
}
