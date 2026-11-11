import { Module } from '@nestjs/common';
import { CmsModule } from '../cms/cms.module';
import { PublicSiteController } from './public-site.controller';
import { PublicSiteService } from './public-site.service';

/** 공개 홈페이지 API (/public/*) — 게시 콘텐츠 조회 + 문의 접수 */
@Module({
  imports: [CmsModule],
  controllers: [PublicSiteController],
  providers: [PublicSiteService],
})
export class PublicSiteModule {}
