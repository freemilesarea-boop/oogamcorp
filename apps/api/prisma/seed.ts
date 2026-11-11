/**
 * 초기 데이터 시드 (멱등). 비밀번호는 환경변수 SEED_OWNER_PASSWORD 로만 주입한다.
 * 개발 환경에서 미지정 시 무작위 비밀번호를 생성해 콘솔에 1회 출력한다.
 */
import { PrismaClient, Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { DEFAULT_ROLE_PERMISSIONS, PERMISSIONS, ROLE_LABELS, ROLE_RANK, SYSTEM_ROLES } from '@oogam/shared';

const prisma = new PrismaClient();

export async function seed(client: PrismaClient = prisma, opts: { quiet?: boolean } = {}) {
  const log = (...a: unknown[]) => !opts.quiet && console.log(...a);
  const orgSlug = process.env.SEED_ORG_SLUG ?? 'oogam';
  const org = await client.organization.upsert({
    where: { slug: orgSlug },
    create: { name: 'OOGAM', slug: orgSlug, domain: 'oogam.co.kr' },
    update: {},
  });

  // 권한 카탈로그
  for (const [key, meta] of Object.entries(PERMISSIONS)) {
    await client.permission.upsert({
      where: { key },
      create: { key, module: meta.module, label: meta.label, sensitive: meta.sensitive },
      update: { module: meta.module, label: meta.label, sensitive: meta.sensitive },
    });
  }
  const perms = await client.permission.findMany();
  const permId = new Map(perms.map((p) => [p.key, p.id]));

  // 시스템 역할 (기존 역할의 권한 변경 내역은 보존: 신규 생성 시에만 기본 권한 부여, OWNER 는 항상 전체 권한 동기화)
  const roles: Record<string, string> = {};
  for (const key of SYSTEM_ROLES) {
    const existing = await client.role.findUnique({ where: { organizationId_key: { organizationId: org.id, key } } });
    const role = existing ?? (await client.role.create({
      data: { organizationId: org.id, key, name: ROLE_LABELS[key], isSystem: true, rank: ROLE_RANK[key] },
    }));
    roles[key] = role.id;
    if (!existing || key === 'OWNER') {
      await client.rolePermission.createMany({
        data: DEFAULT_ROLE_PERMISSIONS[key].map((p) => ({ roleId: role.id, permissionId: permId.get(p)! })),
        skipDuplicates: true,
      });
    }
  }

  // 부서 / 사업 구분
  const deptNames = ['경영지원', '콘텐츠', '테크', '브랜드전략'];
  for (const [i, name] of deptNames.entries()) {
    await client.department.upsert({
      where: { organizationId_name: { organizationId: org.id, name } },
      create: { organizationId: org.id, name, sortOrder: i },
      update: {},
    });
  }
  const units = [
    { code: 'CREATIVE', name: 'Creative Business' },
    { code: 'MEDIA', name: 'Media' },
    { code: 'TECH', name: 'Technology' },
    { code: 'EDU', name: '콘텐츠 제작·교육' },
  ];
  for (const u of units) {
    await client.businessUnit.upsert({
      where: { organizationId_code: { organizationId: org.id, code: u.code } },
      create: { organizationId: org.id, ...u },
      update: {},
    });
  }

  // 기본 워크스페이스
  const ws = await client.workspace.upsert({
    where: { organizationId_slug: { organizationId: org.id, slug: 'oogam' } },
    create: { organizationId: org.id, name: 'OOGAM 워크스페이스', slug: 'oogam', isDefault: true, icon: '◼' },
    update: {},
  });

  // 최고관리자
  const ownerEmail = (process.env.SEED_OWNER_EMAIL ?? 'owner@oogam.co.kr').toLowerCase();
  let ownerPassword = process.env.SEED_OWNER_PASSWORD;
  const existingOwner = await client.user.findUnique({ where: { email: ownerEmail } });
  if (!existingOwner) {
    if (!ownerPassword) {
      if (process.env.NODE_ENV === 'production') throw new Error('운영 환경에서는 SEED_OWNER_PASSWORD 가 필요합니다.');
      ownerPassword = randomBytes(12).toString('base64url') + '1a';
      log(`\n[seed] 최고관리자 임시 비밀번호(1회 출력): ${ownerPassword}\n       로그인 후 즉시 변경하세요.\n`);
    }
    const owner = await client.user.create({
      data: {
        email: ownerEmail,
        name: process.env.SEED_OWNER_NAME ?? '최고관리자',
        status: 'ACTIVE',
        passwordHash: await argon2.hash(ownerPassword, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 }),
        passwordChangedAt: new Date(),
      },
    });
    const mgmt = await client.department.findFirst({ where: { organizationId: org.id, name: '경영지원' } });
    await client.membership.create({
      data: { organizationId: org.id, userId: owner.id, roleId: roles.OWNER, departmentId: mgmt?.id, title: '대표', hireDate: new Date() },
    });
    await client.workspaceMember.create({ data: { workspaceId: ws.id, userId: owner.id, role: 'ADMIN' } });
    log(`[seed] 최고관리자 생성: ${ownerEmail}`);
  }

  // CMS 고정 페이지 — Hero 는 임시 브랜드 카피 (CMS 에서 수정 가능)
  const home = {
    hero: {
      eyebrow: 'OOGAM',
      title: 'Ideas Become Impact.',
      lines: ['AI Education.', 'AI Music Media.', 'AI Technology.'],
      ctaLabel: '함께 일하기',
      ctaHref: '/contact',
    },
    intro: {
      heading: '아이디어를 실행 가능한 임팩트로.',
      body: 'OOGAM은 AI 교육, AI 음악 미디어, AI 기술을 하나의 흐름으로 연결합니다. (임시 소개 문구 — CMS에서 수정하세요)',
    },
    business: [
      { key: 'ai-education', title: 'AI Education', body: 'AI를 이해하고 실무에 활용하는 역량을 키우는 교육' },
      { key: 'ai-music-media', title: 'AI Music Media', body: 'AI 기술을 활용한 음악·오디오 콘텐츠와 미디어 운영' },
      { key: 'ai-technology', title: 'AI Technology', body: 'AI 서비스와 플랫폼을 위한 기술 연구·개발' },
    ],
    cta: { heading: '새로운 프로젝트를 함께 만들어 갈 파트너를 찾습니다.', label: '파트너십 문의', href: '/contact' },
  };
  const pages: { key: string; title: string; content: Prisma.InputJsonValue }[] = [
    { key: 'home', title: '홈', content: home },
    { key: 'about', title: '회사 소개', content: { heading: 'About OOGAM', body: '회사 소개 본문을 CMS에서 작성하세요.', values: [] } },
    { key: 'business', title: '사업 영역', content: { heading: 'Business', body: '사업 영역 소개를 CMS에서 작성하세요.', areas: home.business } },
    { key: 'careers', title: '채용', content: { heading: 'Careers', body: '채용 안내 문구를 CMS에서 작성하세요.' } },
    { key: 'contact', title: '문의', content: { heading: 'Contact', body: '프로젝트·제휴·채용 문의를 남겨주세요.', email: 'contact@oogam.co.kr' } },
    { key: 'privacy', title: '개인정보처리방침', content: { heading: '개인정보처리방침', body: '[법무 검토 필요] 개인정보처리방침 초안을 CMS에서 작성하세요. 시행일과 처리 목적·보관 기간·위탁 현황을 반드시 기재해야 합니다.' } },
    { key: 'terms', title: '이용약관', content: { heading: '이용약관', body: '[법무 검토 필요] 이용약관 초안을 CMS에서 작성하세요.' } },
  ];
  for (const p of pages) {
    await client.websitePage.upsert({
      where: { organizationId_key: { organizationId: org.id, key: p.key } },
      create: {
        organizationId: org.id, key: p.key, title: p.title, content: p.content,
        publishedContent: p.content, status: 'PUBLISHED', publishedAt: new Date(),
        seoTitle: p.key === 'home' ? 'OOGAM — Ideas Become Impact.' : `${p.title} | OOGAM`,
      },
      update: {},
    });
  }

  // 브랜드 후보 — 법인 관계 미확인이므로 DRAFT 로만 등록 (공개 사이트 비노출)
  const candidates = [
    { slug: 'deutda', name: '듣다', category: '오디오 콘텐츠' },
    { slug: 'louver', name: 'Louver', category: '브랜드' },
    { slug: '247streams', name: '247Streams', category: '미디어' },
    { slug: 'content-edu', name: '콘텐츠 제작·교육', category: '교육' },
  ];
  for (const [i, b] of candidates.entries()) {
    await client.brand.upsert({
      where: { organizationId_slug: { organizationId: org.id, slug: b.slug } },
      create: {
        organizationId: org.id, ...b, sortOrder: i, status: 'DRAFT',
        relationshipNote: '초기 등록 후보 — 법인 소유·운영 관계 확인 전에는 공식 계열사/자회사로 표기하지 말 것',
      },
      update: {},
    });
  }

  return { organizationId: org.id, workspaceId: ws.id, roles };
}

if (require.main === module) {
  seed()
    .then(() => console.log('[seed] 완료'))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
