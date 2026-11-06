import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthContext } from '../../common/auth/auth.types';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators';
import { ApprovalsService } from './approvals.service';
import {
  ApprovalActionDto, ApprovalCommentDto, ApprovalQueryDto, CreateApprovalDto, RequiredCommentActionDto, UpdateApprovalDto,
} from './dto/approval.dto';

/**
 * 전자결재 API. 문서 접근은 EntityAccessService(APPROVAL) 기준(기안자·결재선·approvals.read_all).
 * 결재 처리 권한은 결재선의 현재 단계 결재자 여부로 서버에서 판단한다.
 */
@ApiTags('Approvals')
@Controller('approvals')
export class ApprovalsController {
  constructor(private readonly approvals: ApprovalsService) {}

  @Get()
  list(@CurrentUser() u: AuthContext, @Query() q: ApprovalQueryDto) {
    return this.approvals.list(u, q);
  }

  @Get('summary')
  summary(@CurrentUser() u: AuthContext) {
    return this.approvals.summary(u);
  }

  @RequirePermissions('approvals.request')
  @Post()
  create(@CurrentUser() u: AuthContext, @Body() dto: CreateApprovalDto) {
    return this.approvals.create(u, dto);
  }

  @Get(':id')
  get(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.approvals.get(u, id);
  }

  @RequirePermissions('approvals.request')
  @Patch(':id')
  update(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateApprovalDto) {
    return this.approvals.update(u, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.approvals.remove(u, id);
  }

  @RequirePermissions('approvals.request')
  @Post(':id/submit')
  submit(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ApprovalActionDto) {
    return this.approvals.submit(u, id, dto);
  }

  @Post(':id/approve')
  approve(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ApprovalActionDto) {
    return this.approvals.approve(u, id, dto);
  }

  @Post(':id/reject')
  reject(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RequiredCommentActionDto) {
    return this.approvals.reject(u, id, dto);
  }

  @Post(':id/request-changes')
  requestChanges(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RequiredCommentActionDto) {
    return this.approvals.requestChanges(u, id, dto);
  }

  @Post(':id/cancel')
  cancel(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ApprovalActionDto) {
    return this.approvals.cancel(u, id, dto);
  }

  @Post(':id/comments')
  comment(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ApprovalCommentDto) {
    return this.approvals.comment(u, id, dto);
  }
}
