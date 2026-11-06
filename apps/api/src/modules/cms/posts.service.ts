import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PostType, Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthContext } from '../../common/auth/auth.types';
import { orderByArg, pageArgs, paginated } from '../../common/dto/pagination.dto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { assertEditable, assertTransition, deletedSlug, nullableDate, resolveSlug, transitionAction, validatePostMetadata } from './cms.shared';
import { CreatePostDto, PostQueryDto, StatusChangeDto, UpdatePostDto } from './dto/cms.dto';

@Injectable()
export class PostsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async withAuthors<T extends { authorId: string | null }>(items: T[]) {
    const ids = [...new Set(items.map((p) => p.authorId).filter(Boolean))] as string[];
    const users = ids.length ? await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
    const byId = new Map(users.map((u) => [u.id, u]));
    return items.map((p) => ({ ...p, author: p.authorId ? byId.get(p.authorId) ?? null : null }));
  }

  async list(auth: AuthContext, q: PostQueryDto) {
    const { skip, take, page, pageSize } = pageArgs(q);
    const where: Prisma.WebsitePostWhereInput = {
      organizationId: auth.organizationId,
      deletedAt: null,
      ...(q.type ? { type: q.type } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.q ? { OR: [{ title: { contains: q.q, mode: 'insensitive' } }, { slug: { contains: q.q, mode: 'insensitive' } }] } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.websitePost.findMany({
        where, skip, take,
        orderBy: orderByArg(q, ['updatedAt', 'createdAt', 'publishedAt', 'title', 'status'] as const, 'updatedAt'),
        // 목록에서는 본문 제외 (용량)
        omit: { body: true },
      }),
      this.prisma.websitePost.count({ where }),
    ]);
    return paginated(await this.withAuthors(items), total, page, pageSize);
  }

  async get(auth: AuthContext, id: string) {
    const post = await this.prisma.websitePost.findFirst({ where: { id, organizationId: auth.organizationId, deletedAt: null } });
    if (!post) throw new NotFoundException('게시물을 찾을 수 없습니다.');
    return (await this.withAuthors([post]))[0];
  }

  private async assertSlugFree(auth: AuthContext, type: PostType, slug: string, exceptId?: string) {
    const dup = await this.prisma.websitePost.findFirst({
      where: { organizationId: auth.organizationId, type, slug, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true },
    });
    if (dup) throw new ConflictException('같은 유형에서 이미 사용 중인 슬러그입니다.');
  }

  async create(auth: AuthContext, dto: CreatePostDto) {
    const slug = resolveSlug(dto.slug, dto.title);
    await this.assertSlugFree(auth, dto.type, slug);
    const post = await this.prisma.websitePost.create({
      data: {
        organizationId: auth.organizationId,
        type: dto.type,
        slug,
        title: dto.title,
        excerpt: dto.excerpt,
        body: dto.body ?? '',
        coverImageUrl: dto.coverImageUrl,
        metadata: validatePostMetadata(dto.type, dto.metadata) ?? {},
        publishedAt: nullableDate(dto.publishedAt),
        seoTitle: dto.seoTitle,
        seoDescription: dto.seoDescription,
        status: 'DRAFT',
        authorId: auth.userId,
      },
    });
    await this.audit.forUser(auth, 'cms.post.created', { entityType: 'website_post', entityId: post.id, metadata: { type: dto.type, slug } });
    return post;
  }

  async update(auth: AuthContext, id: string, dto: UpdatePostDto) {
    const post = await this.get(auth, id);
    assertEditable(auth, post.status);
    if (dto.slug && dto.slug !== post.slug) await this.assertSlugFree(auth, post.type, dto.slug, id);
    return this.prisma.websitePost.update({
      where: { id },
      data: {
        ...dto,
        metadata: validatePostMetadata(post.type, dto.metadata),
        publishedAt: nullableDate(dto.publishedAt),
      },
    });
  }

  async changeStatus(auth: AuthContext, id: string, dto: StatusChangeDto) {
    const post = await this.get(auth, id);
    assertTransition(auth, post.status, dto.status);
    const updated = await this.prisma.websitePost.update({
      where: { id },
      data: { status: dto.status, ...(dto.status === 'PUBLISHED' ? { publishedAt: post.publishedAt ?? new Date() } : {}) },
    });
    await this.audit.forUser(auth, transitionAction('post', post.status, dto.status), {
      entityType: 'website_post', entityId: id, metadata: { from: post.status, to: dto.status, type: post.type, slug: post.slug },
    });
    return updated;
  }

  async remove(auth: AuthContext, id: string) {
    const post = await this.get(auth, id);
    assertEditable(auth, post.status);
    await this.prisma.websitePost.update({ where: { id }, data: { deletedAt: new Date(), slug: deletedSlug(post.slug, id) } });
    await this.audit.forUser(auth, 'cms.post.deleted', { entityType: 'website_post', entityId: id, metadata: { type: post.type, slug: post.slug, title: post.title } });
    return { ok: true };
  }
}
