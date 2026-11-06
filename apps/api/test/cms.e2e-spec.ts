import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp, createUser, login, prisma, resetDatabase, type Client } from './helpers';

describe('CMS & public site', () => {
  let app: INestApplication;
  let orgId: string;
  let owner: Client;
  let exec: Client;
  let manager: Client;
  let employee: Client;
  const pub = () => request(app.getHttpServer());

  beforeAll(async () => {
    ({ organizationId: orgId } = await resetDatabase());
    app = await createApp();
    owner = await login(app, 'owner@test.oogam');
    const ex = await createUser(orgId, 'EXECUTIVE');
    const m = await createUser(orgId, 'MANAGER');
    const e = await createUser(orgId, 'EMPLOYEE');
    exec = await login(app, ex.email);
    manager = await login(app, m.email);
    employee = await login(app, e.email);
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  describe('public read endpoints', () => {
    it('serves seeded published pages but hides DRAFT brand candidates', async () => {
      const home = await pub().get('/api/v1/public/home');
      expect(home.status).toBe(200);
      expect(home.body.page.content.hero.title).toBe('Ideas Become Impact.');
      expect(home.body.brands).toEqual([]);
      expect(home.body.news).toEqual([]);
      expect(home.headers['cache-control']).toContain('max-age=60');

      const brands = await pub().get('/api/v1/public/brands');
      expect(brands.status).toBe(200);
      expect(brands.body).toEqual([]);
      expect((await pub().get('/api/v1/public/brands/deutda')).status).toBe(404);

      const site = await pub().get('/api/v1/public/site');
      expect(site.status).toBe(200);
      expect(site.body.nav.length).toBeGreaterThan(3);
    });

    it('rejects unknown pages and bad post types', async () => {
      expect((await pub().get('/api/v1/public/pages/nope')).status).toBe(404);
      expect((await pub().get('/api/v1/public/posts/BLOG/x')).status).toBe(400);
    });

    it('admin CMS endpoints require authentication', async () => {
      expect((await pub().get('/api/v1/cms/brands')).status).toBe(401);
    });
  });

  describe('brand workflow', () => {
    let brandId: string;

    it('employee without cms.read is forbidden', async () => {
      expect((await employee.get('/cms/brands')).status).toBe(403);
    });

    it('manager edits (cms.write) and validates input', async () => {
      const list = await manager.get('/cms/brands');
      expect(list.status).toBe(200);
      const deutda = list.body.items.find((b: { slug: string }) => b.slug === 'deutda');
      expect(deutda.relationshipNote).toBeTruthy();
      brandId = deutda.id;

      expect((await manager.post('/cms/brands', { name: 'x', websiteUrl: 'javascript:alert(1)' })).status).toBe(400);
      expect((await manager.post('/cms/brands', { name: 'x', slug: 'Bad Slug' })).status).toBe(400);
      expect((await manager.post('/cms/brands', { name: 'x', hacker: 1 })).status).toBe(400);
      expect((await manager.post('/cms/brands', { name: '중복', slug: 'deutda' })).status).toBe(409);
      // status 는 생성/수정 DTO 로 바꿀 수 없음
      expect((await manager.patch(`/cms/brands/${brandId}`, { status: 'PUBLISHED' })).status).toBe(400);

      const upd = await manager.patch(`/cms/brands/${brandId}`, { tagline: '오디오 콘텐츠 브랜드', websiteUrl: 'https://example.com' });
      expect(upd.status).toBe(200);
      expect(upd.body.tagline).toBe('오디오 콘텐츠 브랜드');
    });

    it('manager can move DRAFT→REVIEW but cannot publish (403)', async () => {
      expect((await manager.post(`/cms/brands/${brandId}/status`, { status: 'REVIEW' })).status).toBe(200);
      const res = await manager.post(`/cms/brands/${brandId}/status`, { status: 'PUBLISHED', acknowledgeRelationship: true });
      expect(res.status).toBe(403);
      expect((await pub().get('/api/v1/public/brands')).body).toEqual([]);
    });

    it('executive must acknowledge relationship note, then publishes → visible publicly', async () => {
      expect((await exec.post(`/cms/brands/${brandId}/status`, { status: 'PUBLISHED' })).status).toBe(400);
      const res = await exec.post(`/cms/brands/${brandId}/status`, { status: 'PUBLISHED', acknowledgeRelationship: true });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('PUBLISHED');

      const brands = await pub().get('/api/v1/public/brands');
      expect(brands.body).toHaveLength(1);
      expect(brands.body[0].slug).toBe('deutda');
      // 내부 관계 메모는 공개 응답에 포함되지 않음
      expect(brands.body[0].relationshipNote).toBeUndefined();
      const detail = await pub().get('/api/v1/public/brands/deutda');
      expect(detail.status).toBe(200);
      expect(detail.body.portfolio).toEqual([]);

      const audit = await prisma.auditLog.findFirst({ where: { action: 'cms.brand.published', entityId: brandId } });
      expect(audit).not.toBeNull();
    });

    it('manager cannot edit or delete a published brand; executive can unpublish', async () => {
      expect((await manager.patch(`/cms/brands/${brandId}`, { tagline: 'x' })).status).toBe(403);
      expect((await manager.del(`/cms/brands/${brandId}`)).status).toBe(403);
      expect((await manager.post(`/cms/brands/${brandId}/status`, { status: 'DRAFT' })).status).toBe(403);
      expect((await exec.post(`/cms/brands/${brandId}/status`, { status: 'DRAFT' })).status).toBe(200);
      expect((await pub().get('/api/v1/public/brands/deutda')).status).toBe(404);
      expect(await prisma.auditLog.count({ where: { action: 'cms.brand.unpublished', entityId: brandId } })).toBe(1);
    });

    it('reorders brands and soft-deletes', async () => {
      const list = await manager.get('/cms/brands');
      const ids = list.body.items.map((b: { id: string }) => b.id).reverse();
      expect((await manager.put('/cms/brands/order', { ids })).status).toBe(200);
      const after = await manager.get('/cms/brands');
      expect(after.body.items.map((b: { id: string }) => b.id)).toEqual(ids);

      const created = await manager.post('/cms/brands', { name: 'Temp Brand' });
      expect(created.status).toBe(201);
      expect(created.body.slug).toBe('temp-brand');
      expect(created.body.status).toBe('DRAFT');
      expect((await manager.del(`/cms/brands/${created.body.id}`)).status).toBe(200);
      expect((await manager.get(`/cms/brands/${created.body.id}`)).status).toBe(404);
      const row = await prisma.brand.findUnique({ where: { id: created.body.id } });
      expect(row?.deletedAt).not.toBeNull();
      // 슬러그 재사용 가능
      expect((await manager.post('/cms/brands', { name: 'Temp Brand' })).status).toBe(201);
      expect(await prisma.auditLog.count({ where: { action: 'cms.brand.deleted', entityId: created.body.id } })).toBe(1);
    });
  });

  describe('portfolio', () => {
    it('only published featured items appear on home; unpublished brand is masked', async () => {
      const brands = await manager.get('/cms/brands?q=louver');
      const louverId = brands.body.items[0].id;
      const item = await manager.post('/cms/portfolio', { title: 'Campaign One', brandId: louverId, featured: true, year: 2026, tags: ['film'] });
      expect(item.status).toBe(201);
      expect((await pub().get('/api/v1/public/portfolio')).body).toEqual([]);
      expect((await manager.post(`/cms/portfolio/${item.body.id}/status`, { status: 'PUBLISHED' })).status).toBe(403);
      expect((await exec.post(`/cms/portfolio/${item.body.id}/status`, { status: 'PUBLISHED' })).status).toBe(200);
      const home = await pub().get('/api/v1/public/home');
      expect(home.body.featured).toHaveLength(1);
      expect(home.body.featured[0].brand).toBeNull(); // Louver 는 DRAFT
      const all = await pub().get('/api/v1/public/portfolio');
      expect(all.body).toHaveLength(1);
      expect(all.body[0].brand).toBeNull();
    });
  });

  describe('pages: draft vs published separation', () => {
    it('editor saves a draft; public keeps serving publishedContent until publish', async () => {
      const current = await manager.get('/cms/pages/home');
      expect(current.status).toBe(200);
      expect(current.body.hasUnpublishedChanges).toBe(false);
      const content = { ...current.body.content, hero: { ...current.body.content.hero, title: 'Draft Headline.' } };

      // 키별 구조 검증
      expect((await manager.put('/cms/pages/home', { content: { hero: { title: 123 } } })).status).toBe(400);
      expect((await manager.put('/cms/pages/home', { content: { unknownField: 'x' } })).status).toBe(400);
      expect((await manager.put('/cms/pages/home', { content: { cta: { href: 'javascript:alert(1)' } } })).status).toBe(400);
      expect((await manager.put('/cms/pages/nope', { content: {} })).status).toBe(404);

      const saved = await manager.put('/cms/pages/home', { content, seoTitle: 'OOGAM' });
      expect(saved.status).toBe(200);
      expect(saved.body.hasUnpublishedChanges).toBe(true);

      const pubHome = await pub().get('/api/v1/public/pages/home');
      expect(pubHome.body.content.hero.title).toBe('Ideas Become Impact.');
      const preview = await manager.get('/cms/pages/home/preview');
      expect(preview.body.content.hero.title).toBe('Draft Headline.');

      expect((await manager.post('/cms/pages/home/publish')).status).toBe(403);
      expect((await exec.post('/cms/pages/home/publish')).status).toBe(200);
      const after = await pub().get('/api/v1/public/pages/home');
      expect(after.body.content.hero.title).toBe('Draft Headline.');
      expect(await prisma.auditLog.count({ where: { action: 'cms.page.published' } })).toBe(1);
    });

    it('creates site settings page and exposes it only after publish', async () => {
      const res = await manager.put('/cms/pages/site', { content: { companyName: '주식회사 OOGAM', email: 'hello@oogam.co.kr', socials: [{ label: 'Instagram', href: 'https://instagram.com/oogam' }] } });
      expect(res.status).toBe(200);
      expect((await pub().get('/api/v1/public/site')).body.footer).toBeNull();
      expect((await owner.post('/cms/pages/site/publish')).status).toBe(200);
      expect((await pub().get('/api/v1/public/site')).body.footer.companyName).toBe('주식회사 OOGAM');
    });

    it('unpublish hides the page publicly', async () => {
      expect((await exec.post('/cms/pages/terms/unpublish')).status).toBe(200);
      expect((await pub().get('/api/v1/public/pages/terms')).status).toBe(404);
    });
  });

  describe('posts', () => {
    const xss = '<script>alert("x")</script><img src=x onerror=alert(1)>\n\n# Heading\n\n[bad](javascript:alert(1))';
    let newsId: string;

    it('stores XSS payload verbatim and returns it as plain text (no server-side HTML)', async () => {
      const res = await manager.post('/cms/posts', { type: 'NEWS', title: 'Launch News', body: xss, excerpt: 'Hello' });
      expect(res.status).toBe(201);
      newsId = res.body.id;
      expect((await pub().get('/api/v1/public/posts/NEWS/launch-news')).status).toBe(404);
      expect((await manager.post(`/cms/posts/${newsId}/status`, { status: 'REVIEW' })).status).toBe(200);
      expect((await exec.post(`/cms/posts/${newsId}/status`, { status: 'PUBLISHED' })).status).toBe(200);

      const detail = await pub().get('/api/v1/public/posts/NEWS/launch-news');
      expect(detail.status).toBe(200);
      expect(detail.headers['content-type']).toContain('application/json');
      expect(detail.body.body).toBe(xss);
      expect(detail.body.authorId).toBeUndefined();

      const list = await pub().get('/api/v1/public/posts?type=NEWS');
      expect(list.body.total).toBe(1);
      expect(list.body.items[0].body).toBeUndefined();
      expect((await pub().get('/api/v1/public/home')).body.news).toHaveLength(1);
    });

    it('future publishedAt is hidden until the date', async () => {
      const res = await manager.post('/cms/posts', { type: 'INSIGHT', title: 'Future Insight', publishedAt: '2099-01-01T00:00:00Z' });
      expect((await exec.post(`/cms/posts/${res.body.id}/status`, { status: 'PUBLISHED' })).status).toBe(200);
      expect((await pub().get('/api/v1/public/posts/INSIGHT/future-insight')).status).toBe(404);
    });

    it('validates career metadata', async () => {
      expect((await manager.post('/cms/posts', { type: 'CAREER', title: 'Bad', metadata: { salary: '1' } })).status).toBe(400);
      expect((await manager.post('/cms/posts', { type: 'CAREER', title: 'Bad2', metadata: { applyUrl: 'javascript:x' } })).status).toBe(400);
      expect((await manager.post('/cms/posts', { type: 'NEWS', title: 'Bad3', metadata: { location: 'Seoul' } })).status).toBe(400);
      const ok = await manager.post('/cms/posts', {
        type: 'CAREER', title: 'Product Designer', metadata: { location: '서울', employmentType: 'FULL_TIME', deadline: '2026-12-31' },
      });
      expect(ok.status).toBe(201);
      expect(ok.body.metadata.location).toBe('서울');
    });

    it('sitemap lists only live content', async () => {
      const sm = await pub().get('/api/v1/public/sitemap');
      expect(sm.status).toBe(200);
      expect(sm.body.posts).toHaveLength(1);
      expect(sm.body.brands).toHaveLength(0);
      expect(sm.body.pages.find((p: { key: string }) => p.key === 'site')).toBeUndefined();
    });

    it('overview counts and pending items', async () => {
      const ov = await manager.get('/cms/overview');
      expect(ov.status).toBe(200);
      expect(ov.body.posts.NEWS.PUBLISHED).toBe(1);
      expect(ov.body.inquiries).toBeNull(); // 매니저는 cms.inquiries 없음
      expect(ov.body.canPublish).toBe(false);
    });
  });

  describe('inquiries', () => {
    const valid = { name: '홍길동', email: 'Hong@Example.com', phone: '010-1234-5678', company: 'ACME', category: 'PROJECT', message: '프로젝트 협업 문의드립니다. 연락 부탁드립니다.', privacyConsent: true };
    const post = (body: object) => pub().post('/api/v1/public/inquiries').set('User-Agent', 'jest').set('X-Forwarded-For', '203.0.113.7').send(body);

    it('validates fields and requires privacy consent', async () => {
      expect((await post({ ...valid, privacyConsent: false })).status).toBe(400);
      const { privacyConsent: _omit, ...noConsent } = valid;
      expect((await post(noConsent)).status).toBe(400);
      expect((await post({ ...valid, email: 'not-an-email' })).status).toBe(400);
      expect((await post({ ...valid, phone: 'abc' })).status).toBe(400);
      expect((await post({ ...valid, message: 'short' })).status).toBe(400);
      expect((await post({ ...valid, message: 'x'.repeat(5001) })).status).toBe(400);
      expect((await post({ ...valid, extra: 1 })).status).toBe(400);
      expect(await prisma.contactInquiry.count()).toBe(0);
    });

    it('rejects cross-origin posts', async () => {
      const res = await pub().post('/api/v1/public/inquiries').set('Origin', 'https://evil.example').send(valid);
      expect(res.status).toBe(403);
    });

    it('silently drops honeypot submissions', async () => {
      const res = await post({ ...valid, website: 'http://spam.example' });
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ ok: true });
      expect(await prisma.contactInquiry.count()).toBe(0);
    });

    it('stores a hashed IP (never raw) and notifies cms.inquiries holders only', async () => {
      const res = await post(valid);
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ ok: true });
      const rows = await prisma.contactInquiry.findMany();
      expect(rows).toHaveLength(1);
      const row = rows[0];
      expect(row.email).toBe('hong@example.com');
      expect(row.ipHash).toBeTruthy();
      expect(row.ipHash).not.toContain('203.0.113.7');
      expect(row.ipHash).toMatch(/^[0-9a-f]{32}$/);
      expect(JSON.stringify(row)).not.toContain('203.0.113.7');
      expect(row.consentAt).toBeInstanceOf(Date);

      const notes = await prisma.notification.findMany({ where: { type: 'SYSTEM', link: '/admin/cms/inquiries' } });
      const recipients = new Set(notes.map((n) => n.userId));
      const execUser = await prisma.user.findFirst({ where: { email: { startsWith: 'executive' } } });
      const mgrUser = await prisma.user.findFirst({ where: { email: { startsWith: 'manager' } } });
      expect(recipients.has(execUser!.id)).toBe(true);
      expect(recipients.has(mgrUser!.id)).toBe(false);
      // 알림 본문에 개인정보 미포함
      expect(notes.every((n) => !`${n.title}${n.body}`.includes('홍길동'))).toBe(true);
    });

    it('requires cms.inquiries to list/view; viewing is audited', async () => {
      expect((await manager.get('/cms/inquiries')).status).toBe(403);
      expect((await employee.get('/cms/inquiries')).status).toBe(403);
      const list = await exec.get('/cms/inquiries');
      expect(list.status).toBe(200);
      expect(list.body.total).toBe(1);
      expect(list.body.items[0].ipHash).toBeUndefined();
      const id = list.body.items[0].id;
      expect((await manager.get(`/cms/inquiries/${id}`)).status).toBe(403);
      const detail = await exec.get(`/cms/inquiries/${id}`);
      expect(detail.status).toBe(200);
      expect(detail.body.message).toContain('협업');
      expect(await prisma.auditLog.count({ where: { action: 'cms.inquiry.viewed', entityId: id } })).toBe(1);

      const upd = await exec.patch(`/cms/inquiries/${id}`, { status: 'IN_PROGRESS', internalNote: '담당자 배정' });
      expect(upd.status).toBe(200);
      expect(upd.body.status).toBe('IN_PROGRESS');
      expect(upd.body.handledBy.id).toBeTruthy();
      expect((await exec.patch(`/cms/inquiries/${id}`, { status: 'WHATEVER' })).status).toBe(400);
      expect((await manager.patch(`/cms/inquiries/${id}`, { status: 'RESOLVED' })).status).toBe(403);

      const ov = await exec.get('/cms/overview');
      expect(ov.body.inquiries.recent).toHaveLength(1);
    });
  });
});
