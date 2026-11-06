import { Module } from '@nestjs/common';
import { BrandsService } from './brands.service';
import {
  CmsBrandsController, CmsInquiriesController, CmsOverviewController, CmsPagesController, CmsPortfolioController, CmsPostsController,
} from './cms.controller';
import { InquiriesService } from './inquiries.service';
import { OverviewService } from './overview.service';
import { PagesService } from './pages.service';
import { PortfolioService } from './portfolio.service';
import { PostsService } from './posts.service';

/** 홈페이지 CMS (관리자): 브랜드·포트폴리오·고정 페이지·게시물·문의 */
@Module({
  controllers: [CmsOverviewController, CmsBrandsController, CmsPortfolioController, CmsPostsController, CmsPagesController, CmsInquiriesController],
  providers: [BrandsService, PortfolioService, PostsService, PagesService, InquiriesService, OverviewService],
})
export class CmsModule {}
