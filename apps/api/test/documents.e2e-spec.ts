import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as Y from 'yjs';
import { CollabPersistence } from '../src/modules/documents/collab-persistence';
import { jsonToYdoc, ydocToJson } from '../src/modules/documents/ydoc';
import { createApp, createUser, login, prisma, resetDatabase, TEST_PASSWORD, type Client } from './helpers';

const doc = (...texts: string[]) => ({
  type: 'doc',
  content: texts.map((t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })),
});

describe('Documents, comments & collaboration', () => {
  let app: INestApplication;
  let orgId: string;
  let owner: Client;
  let alice: Client;
  let bob: Client;
  let carol: Client;
  let guest: Client;
  let aliceId: string;
  let bobId: string;
  let carolId: string;
  let aliceEmail: string;

  beforeAll(async () => {
    ({ organizationId: orgId } = await resetDatabase());
    app = await createApp();
    owner = await login(app, 'owner@test.oogam');
    const a = await createUser(orgId, 'EMPLOYEE', { departmentName: '테크', name: '앨리스' });
    const b = await createUser(orgId, 'EMPLOYEE', { departmentName: '콘텐츠', name: '밥' });
    const c = await createUser(orgId, 'EMPLOYEE', { departmentName: '콘텐츠', name: '캐럴' });
    const g = await createUser(orgId, 'GUEST', { name: '게스트' });
    aliceId = a.id;
    bobId = b.id;
    carolId = c.id;
    aliceEmail = a.email;
    alice = await login(app, a.email);
    bob = await login(app, b.email);
    carol = await login(app, c.email);
    guest = await login(app, g.email);
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  let rootId: string;
  let childId: string;

  it('lists workspaces', async () => {
    const res = await alice.get('/workspaces');
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect((await alice.get(`/workspaces/${res.body[0].id}`)).status).toBe(200);
  });

  it('creates documents and builds an access-filtered tree', async () => {
    const r = await alice.post('/documents', { title: '온보딩 가이드', icon: '📘' });
    expect(r.status).toBe(201);
    expect(r.body.access).toBe('FULL');
    rootId = r.body.id;
    const c = await alice.post('/documents', { title: '첫 주 체크리스트', parentId: rootId });
    expect(c.status).toBe(201);
    childId = c.body.id;
    expect((await alice.post('/documents', { title: 'x', bogus: 1 })).status).toBe(400);
    expect((await guest.post('/documents', { title: 'x' })).status).toBe(403);

    const tree = await bob.get('/documents/tree');
    expect(tree.status).toBe(200);
    const node = tree.body.items.find((n: { id: string }) => n.id === rootId);
    expect(node.children.map((n: { id: string }) => n.id)).toEqual([childId]);
    expect(node.access).toBe('EDIT');

    const get = await guest.get(`/documents/${rootId}`);
    expect(get.status).toBe(200);
    expect(get.body.access).toBe('VIEW');
  });

  it('autosaves with optimistic concurrency (409 on stale baseVersion) and sanitizes javascript: links', async () => {
    const content = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: '신규 입사자 환영 문서 alpha-keyword' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'click', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] },
        { type: 'image', attrs: { src: 'javascript:alert(2)' } },
      ],
    };
    const s1 = await alice.put(`/documents/${rootId}/content`, { content, baseVersion: 1 });
    expect(s1.status).toBe(200);
    expect(s1.body.version).toBe(2);
    expect(s1.body.snapshot).toBe(true); // 첫 저장은 AUTO 스냅샷

    const stale = await bob.put(`/documents/${rootId}/content`, { content: doc('bob'), baseVersion: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.currentVersion).toBe(2);

    const page = await prisma.page.findUniqueOrThrow({ where: { id: rootId } });
    const json = JSON.stringify(page.content);
    expect(json).not.toContain('javascript:');
    expect(page.contentText).toContain('alpha-keyword');
    expect((await guest.put(`/documents/${rootId}/content`, { content: doc('g'), baseVersion: 2 })).status).toBe(403);
    expect((await alice.put(`/documents/${rootId}/content`, { content: { type: 'paragraph' }, baseVersion: 2 })).status).toBe(400);
  });

  it('searches title and body text', async () => {
    const res = await bob.get('/documents?q=alpha-keyword');
    expect(res.status).toBe(200);
    expect(res.body.items.map((i: { id: string }) => i.id)).toContain(rootId);
    expect(res.body.items[0].snippet).toContain('alpha-keyword');
    const byTitle = await bob.get(`/documents?q=${encodeURIComponent('체크리스트')}`);
    expect(byTitle.body.items.map((i: { id: string }) => i.id)).toContain(childId);
  });

  let privateId: string;
  let restrictedId: string;

  it('denies PRIVATE and RESTRICTED pages to other users, including tree/search', async () => {
    privateId = (await alice.post('/documents', { title: '개인 메모 secret-word', visibility: 'PRIVATE' })).body.id;
    restrictedId = (await alice.post('/documents', { title: '제한 문서', visibility: 'RESTRICTED' })).body.id;
    for (const id of [privateId, restrictedId]) {
      expect((await bob.get(`/documents/${id}`)).status).toBe(404);
      expect((await bob.put(`/documents/${id}/content`, { content: doc('x'), baseVersion: 1 })).status).toBe(404);
      expect((await bob.get(`/comments?targetType=PAGE&targetId=${id}`)).status).toBe(404);
    }
    const tree = await bob.get('/documents/tree');
    const ids = JSON.stringify(tree.body);
    expect(ids).not.toContain(privateId);
    expect(ids).not.toContain(restrictedId);
    const search = await bob.get('/documents?q=secret-word');
    expect(search.body.items).toHaveLength(0);
    // 문서 관리자(docs.manage)는 접근 가능
    expect((await owner.get(`/documents/${privateId}`)).status).toBe(200);
  });

  it('manages grants and visibility (FULL required) with audit logs', async () => {
    expect((await bob.post(`/documents/${restrictedId}/access/grants`, { userId: bobId, access: 'FULL' })).status).toBe(404);
    const g = await alice.post(`/documents/${restrictedId}/access/grants`, { userId: bobId, access: 'VIEW' });
    expect(g.status).toBe(201);
    expect((await bob.get(`/documents/${restrictedId}`)).body.access).toBe('VIEW');
    expect((await bob.put(`/documents/${restrictedId}/content`, { content: doc('x'), baseVersion: 1 })).status).toBe(403);
    expect((await bob.get(`/documents/${restrictedId}/access`)).status).toBe(403);
    // 승격 (upsert)
    const g2 = await alice.post(`/documents/${restrictedId}/access/grants`, { userId: bobId, access: 'EDIT' });
    expect(g2.body.id).toBe(g.body.id);
    expect((await bob.put(`/documents/${restrictedId}/content`, { content: doc('bob edit'), baseVersion: 1 })).status).toBe(200);
    const list = await alice.get(`/documents/${restrictedId}/access`);
    expect(list.body.grants).toHaveLength(1);
    expect((await alice.post(`/documents/${restrictedId}/access/grants`, { userId: bobId, departmentId: list.body.grants[0].id, access: 'VIEW' })).status).toBe(400);
    expect((await alice.del(`/documents/${restrictedId}/access/grants/${g.body.id}`)).status).toBe(200);
    expect((await bob.get(`/documents/${restrictedId}`)).status).toBe(404);

    expect((await alice.patch(`/documents/${privateId}/visibility`, { visibility: 'WORKSPACE' })).status).toBe(200);
    expect((await bob.get(`/documents/${privateId}`)).status).toBe(200);
    const audits = await prisma.auditLog.findMany({ where: { entityId: { in: [restrictedId, privateId] } } });
    const actions = audits.map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['page.grant.set', 'page.grant.removed', 'page.visibility.changed']));
    // 공유 알림
    expect(await prisma.notification.count({ where: { userId: bobId, entityId: restrictedId } })).toBe(1);
  });

  it('restricts child pages under a restricted parent (inheritance)', async () => {
    const sub = await alice.post('/documents', { title: '하위', parentId: restrictedId });
    expect(sub.status).toBe(201);
    expect((await bob.get(`/documents/${sub.body.id}`)).status).toBe(404);
  });

  let commentId: string;

  it('creates threaded comments with mentions and notifications', async () => {
    const c = await bob.post('/comments', { targetType: 'PAGE', targetId: rootId, body: '좋은 문서네요 @캐럴', mentions: [carolId] });
    expect(c.status).toBe(201);
    commentId = c.body.id;
    const mention = await prisma.notification.findFirst({ where: { userId: carolId, type: 'MENTION' } });
    expect(mention?.link).toBe(`/admin/docs/${rootId}`);
    const toOwner = await prisma.notification.findFirst({ where: { userId: aliceId, type: 'COMMENT', entityId: rootId } });
    expect(toOwner).toBeTruthy();

    const reply = await alice.post('/comments', { targetType: 'PAGE', targetId: rootId, body: '감사합니다', parentId: commentId });
    expect(reply.status).toBe(201);
    expect(await prisma.notification.count({ where: { userId: bobId, type: 'COMMENT' } })).toBe(1);

    const list = await carol.get(`/comments?targetType=PAGE&targetId=${rootId}`);
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].replies).toHaveLength(1);
    expect(list.body.items[0].mentions[0].id).toBe(carolId);

    // 볼 수 없는 사용자 멘션 거부 (RESTRICTED 문서에 bob 멘션)
    expect((await alice.post('/comments', { targetType: 'PAGE', targetId: restrictedId, body: 'hi', mentions: [bobId] })).status).toBe(400);
    // 게스트는 열람만 (VIEW → 댓글 불가)
    expect((await guest.get(`/comments?targetType=PAGE&targetId=${rootId}`)).status).toBe(200);
    expect((await guest.post('/comments', { targetType: 'PAGE', targetId: rootId, body: 'x' })).status).toBe(403);
    expect((await bob.post('/comments', { targetType: 'PAGE', targetId: rootId, body: '' })).status).toBe(400);
    expect((await bob.post('/comments', { targetType: 'PAGE', targetId: rootId, body: 'x'.repeat(5001) })).status).toBe(400);
  });

  it('edits, resolves and deletes comments with ownership checks', async () => {
    expect((await alice.patch(`/comments/${commentId}`, { body: 'hack' })).status).toBe(403);
    const e = await bob.patch(`/comments/${commentId}`, { body: '수정됨' });
    expect(e.status).toBe(200);
    expect(e.body.editedAt).toBeTruthy();
    expect((await alice.post(`/comments/${commentId}/resolve`, {})).body.resolvedAt).toBeTruthy();
    expect((await carol.del(`/comments/${commentId}`)).status).toBe(403);
    expect((await bob.del(`/comments/${commentId}`)).status).toBe(200);
    const list = await carol.get(`/comments?targetType=PAGE&targetId=${rootId}`);
    // 답글이 남아 있으므로 삭제 자리표시자로 유지
    expect(list.body.items[0].deleted).toBe(true);
    expect(list.body.items[0].body).toBe('');
  });

  it('moves and reorders with cycle prevention', async () => {
    expect((await alice.post(`/documents/${rootId}/move`, { parentId: childId })).status).toBe(400);
    expect((await alice.post(`/documents/${rootId}/move`, { parentId: rootId })).status).toBe(400);
    const second = (await alice.post('/documents', { title: '두번째', parentId: rootId })).body.id;
    const mv = await alice.post(`/documents/${second}/move`, { parentId: rootId, beforeId: childId });
    expect(mv.status).toBe(200);
    const tree = await alice.get('/documents/tree');
    const node = tree.body.items.find((n: { id: string }) => n.id === rootId);
    expect(node.children.map((n: { id: string }) => n.id)).toEqual([second, childId]);
    // 최상위로 이동
    expect((await alice.post(`/documents/${second}/move`, { parentId: null })).body.parentId).toBeNull();
  });

  it('duplicates pages with children', async () => {
    const res = await alice.post(`/documents/${rootId}/duplicate`, { includeChildren: true });
    expect(res.status).toBe(201);
    expect(res.body.count).toBe(2);
    const copy = await prisma.page.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(copy.title).toContain('(사본)');
    expect(copy.contentText).toContain('alpha-keyword');
  });

  it('creates pages from templates', async () => {
    const tpl = await alice.post('/documents', { title: '회의록 템플릿', isTemplate: true });
    await alice.put(`/documents/${tpl.body.id}/content`, { content: doc('안건', '결정 사항'), baseVersion: 1 });
    const list = await bob.get('/documents/templates');
    expect(list.body.items.map((i: { id: string }) => i.id)).toContain(tpl.body.id);
    const tree = await bob.get('/documents/tree');
    expect(JSON.stringify(tree.body)).not.toContain(tpl.body.id);
    const created = await bob.post('/documents', { templateId: tpl.body.id, title: '11월 회의' });
    expect(created.status).toBe(201);
    expect(created.body.title).toBe('11월 회의');
    expect(JSON.stringify(created.body.content)).toContain('결정 사항');
    expect((await bob.post('/documents', { templateId: rootId })).status).toBe(400);
  });

  it('versions: manual snapshot, list, get, restore (RESTORE snapshot first)', async () => {
    const before = await alice.get(`/documents/${rootId}`);
    const snap = await alice.post(`/documents/${rootId}/versions`);
    expect(snap.status).toBe(201);
    expect(snap.body.reason).toBe('MANUAL');
    const saved = await alice.put(`/documents/${rootId}/content`, { content: doc('완전히 새로운 내용'), baseVersion: before.body.version });
    expect(saved.status).toBe(200);
    const list = await bob.get(`/documents/${rootId}/versions`);
    expect(list.body.items.length).toBeGreaterThanOrEqual(1);
    const one = await bob.get(`/documents/${rootId}/versions/${snap.body.id}`);
    expect(JSON.stringify(one.body.content)).toContain('alpha-keyword');
    expect((await guest.post(`/documents/${rootId}/versions/${snap.body.id}/restore`)).status).toBe(403);
    const r = await alice.post(`/documents/${rootId}/versions/${snap.body.id}/restore`);
    expect(r.status).toBe(200);
    expect(r.body.version).toBe(saved.body.version + 1);
    const page = await prisma.page.findUniqueOrThrow({ where: { id: rootId } });
    expect(page.contentText).toContain('alpha-keyword');
    const restoreSnap = await prisma.pageSnapshot.findFirst({ where: { pageId: rootId, reason: 'RESTORE' } });
    expect(restoreSnap?.version).toBe(saved.body.version);
    expect(JSON.stringify(restoreSnap?.content)).toContain('완전히 새로운 내용');
  });

  it('soft deletes with descendants, lists trash, restores and purges', async () => {
    const del = await bob.del(`/documents/${rootId}`);
    expect(del.status).toBe(200);
    expect(del.body.count).toBeGreaterThanOrEqual(2);
    expect((await bob.get(`/documents/${childId}`)).status).toBe(404);
    const tree = await bob.get('/documents/tree');
    expect(JSON.stringify(tree.body)).not.toContain(rootId);
    const trash = await alice.get('/documents/trash');
    const ids = trash.body.items.map((i: { id: string }) => i.id);
    expect(ids).toContain(rootId);
    expect(ids).not.toContain(childId); // 묶음 삭제의 하위 문서는 숨김
    expect(trash.body.items.find((i: { id: string }) => i.id === rootId).canPurge).toBe(true);
    expect((await guest.get('/documents/trash')).body.items).toHaveLength(0);

    const rest = await bob.post(`/documents/${rootId}/restore`);
    expect(rest.status).toBe(200);
    expect((await bob.get(`/documents/${childId}`)).status).toBe(200);

    await alice.del(`/documents/${rootId}`);
    expect((await bob.del(`/documents/${rootId}/permanent`)).status).toBe(403);
    expect((await alice.del(`/documents/${childId}/permanent`)).status).toBe(200);
    expect((await alice.del(`/documents/${rootId}/permanent`)).status).toBe(200);
    expect(await prisma.page.count({ where: { id: { in: [rootId, childId] } } })).toBe(0);
    const audit = await prisma.auditLog.findMany({ where: { entityId: rootId } });
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['page.deleted', 'page.restored', 'page.purged']));
  });

  describe('collaboration persistence (Hocuspocus hooks)', () => {
    let pageId: string;
    let token: string;
    const origin = 'http://localhost:3000';
    const persistence = () => new CollabPersistence(prisma, [origin], ['oogam_session']);

    beforeAll(async () => {
      const res = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: aliceEmail, password: TEST_PASSWORD });
      const cookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith('oogam_session='))!;
      token = cookie.split(';')[0].split('=')[1];
      pageId = (await alice.post('/documents', { title: '협업 문서' })).body.id;
      await alice.put(`/documents/${pageId}/content`, { content: doc('시드 내용'), baseVersion: 1 });
    });

    it('round-trips custom nodes between JSON and Yjs', () => {
      const json = {
        type: 'doc',
        content: [
          { type: 'callout', attrs: { emoji: '💡' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi', marks: [{ type: 'bold' }] }] }] },
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '제목' }] },
        ],
      };
      const out = ydocToJson(jsonToYdoc(json));
      expect(out.content).toHaveLength(2);
      expect(JSON.stringify(out)).toContain('"emoji":"💡"');
      expect(JSON.stringify(out)).toContain('"level":2');
      expect(JSON.stringify(out)).toContain('"bold"');
    });

    it('authenticates via session cookie only, enforces origin and access level', async () => {
      const p = persistence();
      const ctx = await p.authenticate({ documentName: `page:${pageId}`, headers: { cookie: `oogam_session=${token}`, origin } });
      expect(ctx.readOnly).toBe(false);
      await expect(p.authenticate({ documentName: `page:${pageId}`, headers: { origin } })).rejects.toThrow();
      await expect(p.authenticate({ documentName: `page:${pageId}`, headers: { cookie: `oogam_session=${token}`, origin: 'https://evil.example' } })).rejects.toThrow();
      await expect(p.authenticate({ documentName: 'page:not-a-uuid', headers: { cookie: `oogam_session=${token}` } })).rejects.toThrow();
      // bob 은 PRIVATE 문서 접근 불가 → 거부
      const priv = (await bob.post('/documents', { title: 'bob private', visibility: 'PRIVATE' })).body.id;
      await expect(p.authenticate({ documentName: `page:${priv}`, headers: { cookie: `oogam_session=${token}` } })).rejects.toThrow();
    });

    it('marks VIEW-level connections read-only', async () => {
      const res = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: (await prisma.user.findFirstOrThrow({ where: { name: '게스트' } })).email, password: TEST_PASSWORD });
      const cookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith('oogam_session='))!;
      const ctx = await persistence().authenticate({ documentName: `page:${pageId}`, headers: { cookie: cookie.split(';')[0] } });
      expect(ctx.readOnly).toBe(true);
    });

    it('seeds from JSON, stores yState/content/version, records updates and COLLAB snapshot, merges external restores', async () => {
      const p = persistence();
      const name = `page:${pageId}`;
      const ydoc = new Y.Doc();
      await p.load(name, ydoc);
      expect(JSON.stringify(ydocToJson(ydoc))).toContain('시드 내용');

      // 편집 후 저장
      const frag = ydoc.getXmlFragment('default');
      const para = new Y.XmlElement('paragraph');
      const text = new Y.XmlText();
      text.insert(0, '실시간 편집');
      para.insert(0, [text]);
      frag.push([para]);
      await prisma.pageSnapshot.deleteMany({ where: { pageId } });
      const stored = await p.store(name, ydoc, aliceId);
      expect(stored?.version).toBe(3);
      expect(stored?.snapshot).toBe(true);
      const page = await prisma.page.findUniqueOrThrow({ where: { id: pageId } });
      expect(page.yState).toBeTruthy();
      expect(page.contentText).toContain('실시간 편집');
      const snap = await prisma.pageSnapshot.findFirst({ where: { pageId, reason: 'COLLAB' } });
      expect(snap?.version).toBe(3);

      // 두 번째 저장: 스냅샷 없이 증분만 기록
      text.insert(0, '추가 ');
      const s2 = await p.store(name, ydoc, aliceId);
      expect(s2?.snapshot).toBe(false);
      expect(await prisma.pageUpdate.count({ where: { pageId } })).toBe(1);

      // REST 로 이전 버전 복원 → 폴링이 메모리 문서에 병합
      const r = await alice.post(`/documents/${pageId}/versions/${snap!.id}/restore`);
      expect(r.status).toBe(200);
      const polled = await p.poll(new Map([[name, ydoc]]));
      expect(polled.changed).toEqual([name]);
      const merged = JSON.stringify(ydocToJson(ydoc));
      expect(merged).toContain('실시간 편집');
      expect(merged).not.toContain('추가 ');
      // 다른 클라이언트(이전 상태 보유)와 병합해도 중복되지 않음
      const stale = new Y.Doc();
      Y.applyUpdate(stale, page.yState!);
      Y.applyUpdate(stale, Y.encodeStateAsUpdate(ydoc));
      Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(stale));
      expect((JSON.stringify(ydocToJson(ydoc)).match(/실시간 편집/g) ?? []).length).toBe(1);

      // 삭제된 문서는 poll 에서 deleted 로 보고
      await alice.del(`/documents/${pageId}`);
      expect((await p.poll(new Map([[name, ydoc]]))).deleted).toEqual([name]);
    });
  });
});
