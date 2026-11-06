import { Body, Controller, Get, Header, HttpCode, Param, ParseEnumPipe, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PostType } from '@prisma/client';
import type { Request } from 'express';
import { Public, SkipCsrf } from '../../common/auth/decorators';
import { clientIp } from '../../common/utils/request';
import { loadConfig } from '../../config/configuration';
import { CreateInquiryDto, PublicPortfolioQueryDto, PublicPostsQueryDto } from './public-site.dto';
import { PublicSiteService } from './public-site.service';

/** 테스트 환경에서는 제한을 완화 (운영/개발은 IP 당 제한 적용) */
const limit = (n: number) => () => (loadConfig().env === 'test' ? 10_000 : n);
const CACHE = 'public, max-age=60, s-maxage=60, stale-while-revalidate=300';

/**
 * 공개 홈페이지 API — 인증 불필요, 게시(PUBLISHED)·게시일 도래 콘텐츠만 반환.
 * 고정 페이지는 publishedContent(승인본)만 노출하며 초안(content)은 절대 반환하지 않는다.
 */
@ApiTags('Public site')
@Public()
@Controller('public')
export class PublicSiteController {
  constructor(private readonly site: PublicSiteService) {}

  @Get('site')
  @Header('Cache-Control', CACHE)
  getSite() {
    return this.site.site();
  }

  @Get('home')
  @Header('Cache-Control', CACHE)
  home() {
    return this.site.home();
  }

  @Get('pages/:key')
  @Header('Cache-Control', CACHE)
  page(@Param('key') key: string) {
    return this.site.page(key);
  }

  @Get('brands')
  @Header('Cache-Control', CACHE)
  brands() {
    return this.site.brands();
  }

  @Get('brands/:slug')
  @Header('Cache-Control', CACHE)
  brand(@Param('slug') slug: string) {
    return this.site.brand(slug);
  }

  @Get('portfolio')
  @Header('Cache-Control', CACHE)
  portfolio(@Query() q: PublicPortfolioQueryDto) {
    return this.site.portfolio(q);
  }

  @Get('posts')
  @Header('Cache-Control', CACHE)
  posts(@Query() q: PublicPostsQueryDto) {
    return this.site.posts(q);
  }

  @Get('posts/:type/:slug')
  @Header('Cache-Control', CACHE)
  post(@Param('type', new ParseEnumPipe(PostType)) type: PostType, @Param('slug') slug: string) {
    return this.site.post(type, slug);
  }

  @Get('sitemap')
  @Header('Cache-Control', CACHE)
  sitemap() {
    return this.site.sitemap();
  }

  /** 문의 접수 — IP 당 10분 5회 제한, 허니팟, 개인정보 동의 필수 */
  @SkipCsrf()
  @Throttle({ default: { limit: limit(5), ttl: 600_000 } })
  @Post('inquiries')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  createInquiry(@Body() dto: CreateInquiryDto, @Req() req: Request) {
    return this.site.createInquiry(dto, { ip: clientIp(req), userAgent: req.header('user-agent') ?? undefined });
  }
}
