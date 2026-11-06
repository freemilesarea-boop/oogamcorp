import { Body, Controller, Delete, Get, HttpCode, Module, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { AuthContext } from '../../common/auth/auth.types';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators';
import { reqMeta } from '../../common/utils/request';
import { CommentQueryDto, CreateCommentDto, ResolveCommentDto, UpdateCommentDto } from './comments.dto';
import { CommentsService } from './comments.service';

/** 범용 댓글 API. 대상별 접근 판단은 서버(EntityAccessService)에서 수행 */
@ApiTags('Comments')
@RequirePermissions('workspace.access')
@Controller('comments')
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}

  @Get()
  list(@CurrentUser() u: AuthContext, @Query() q: CommentQueryDto) {
    return this.comments.list(u, q);
  }

  @Post()
  create(@CurrentUser() u: AuthContext, @Body() dto: CreateCommentDto) {
    return this.comments.create(u, dto);
  }

  @Patch(':id')
  update(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCommentDto) {
    return this.comments.update(u, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.comments.remove(u, id, reqMeta(req));
  }

  @HttpCode(200)
  @Post(':id/resolve')
  resolve(@CurrentUser() u: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ResolveCommentDto) {
    return this.comments.resolve(u, id, dto);
  }
}

@Module({ controllers: [CommentsController], providers: [CommentsService], exports: [CommentsService] })
export class CommentsModule {}
