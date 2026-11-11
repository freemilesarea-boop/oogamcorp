import { Module } from '@nestjs/common';
import { BrandsService } from './brands.service';
import { BusinessAreasService } from './business-areas.service';
import { CmsBusinessAreasController, CmsMediaController, CmsRevisionsController } from './cms-extra.controller';
import { MediaService } from './media.service';
import { MediaUploadInterceptor } from './media-upload.interceptor';
import { RevisionsService } from './revisions.service';
import {
  CmsBrandsController, CmsInquiriesController, CmsOverviewController, CmsPagesController, CmsPortfolioController, CmsPostsController,
} from './cms.controller';
import { InquiriesService } from './inquiries.service';
import { OverviewService } from './overview.service';
import { PagesService } from './pages.service';
import { PortfolioService } from './portfolio.service';
import { PostsService } from './posts.service';

/** 홈페이지 CMS (관리자): 브랜드·포트폴리오·고정 페이지·게시물·문의·사업 영역·이미지·변경 이력 */
@Module({
  controllers: [
    CmsOverviewController, CmsBrandsController, CmsPortfolioController, CmsPostsController, CmsPagesController, CmsInquiriesController,
    CmsBusinessAreasController, CmsRevisionsController, CmsMediaController,
  ],
  providers: [
    BrandsService, PortfolioService, PostsService, PagesService, InquiriesService, OverviewService,
    BusinessAreasService, RevisionsService, MediaService, MediaUploadInterceptor,
  ],
  exports: [MediaService],
})
export class CmsModule {}
