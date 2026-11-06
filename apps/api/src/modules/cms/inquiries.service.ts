import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthContext } from '../../common/auth/auth.types';
import { orderByArg, pageArgs, paginated } from '../../common/dto/pagination.dto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { InquiryQueryDto, UpdateInquiryDto } from './dto/cms.dto';

/** 문의 접수 (개인정보 포함 → cms.inquiries 권한 전용, 상세 열람/변경은 감사 로그) */
@Injectable()
export class InquiriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(auth: AuthContext, q: InquiryQueryDto) {
    const { skip, take, page, pageSize } = pageArgs(q);
    const where: Prisma.ContactInquiryWhereInput = {
      organizationId: auth.organizationId,
      ...(q.status ? { status: q.status } : {}),
      ...(q.category ? { category: q.category } : {}),
      ...(q.q
        ? { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { email: { contains: q.q, mode: 'insensitive' } }, { company: { contains: q.q, mode: 'insensitive' } }] }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.contactInquiry.findMany({
        where, skip, take,
        orderBy: orderByArg(q, ['createdAt', 'updatedAt', 'status', 'name'] as const, 'createdAt'),
        // 목록에서는 해시·UA·메모 제외
        select: { id: true, name: true, email: true, company: true, category: true, status: true, createdAt: true, updatedAt: true, handledById: true },
      }),
      this.prisma.contactInquiry.count({ where }),
    ]);
    return paginated(items, total, page, pageSize);
  }

  private async find(auth: AuthContext, id: string) {
    const inq = await this.prisma.contactInquiry.findFirst({ where: { id, organizationId: auth.organizationId } });
    if (!inq) throw new NotFoundException('문의를 찾을 수 없습니다.');
    return inq;
  }

  private async present(inq: Awaited<ReturnType<InquiriesService['find']>>) {
    const handledBy = inq.handledById
      ? await this.prisma.user.findUnique({ where: { id: inq.handledById }, select: { id: true, name: true } })
      : null;
    return { ...inq, handledBy };
  }

  async get(auth: AuthContext, id: string, meta: { ip?: string; userAgent?: string }) {
    const inq = await this.find(auth, id);
    await this.audit.forUser(auth, 'cms.inquiry.viewed', { entityType: 'contact_inquiry', entityId: id, ...meta });
    return this.present(inq);
  }

  async update(auth: AuthContext, id: string, dto: UpdateInquiryDto, meta: { ip?: string; userAgent?: string }) {
    const before = await this.find(auth, id);
    const inq = await this.prisma.contactInquiry.update({
      where: { id },
      data: {
        ...(dto.status ? { status: dto.status } : {}),
        ...(dto.internalNote !== undefined ? { internalNote: dto.internalNote } : {}),
        handledById: auth.userId,
      },
    });
    await this.audit.forUser(auth, 'cms.inquiry.updated', {
      entityType: 'contact_inquiry', entityId: id, ...meta,
      metadata: { from: before.status, to: inq.status, noteChanged: dto.internalNote !== undefined },
    });
    return this.present(inq);
  }

  /** 개인정보 파기 요청 대응용 영구 삭제 */
  async remove(auth: AuthContext, id: string, meta: { ip?: string; userAgent?: string }) {
    await this.find(auth, id);
    await this.prisma.contactInquiry.delete({ where: { id } });
    await this.audit.forUser(auth, 'cms.inquiry.deleted', { entityType: 'contact_inquiry', entityId: id, ...meta });
    return { ok: true };
  }
}
