#!/usr/bin/env node
/**
 * OOGAM Preview 데모 데이터 생성 (2단계, API 경유 — 실제 업무 규칙·권한·결재 흐름을 그대로 통과).
 * 모든 데이터는 가상이며 "샘플"·"가상" 표기를 붙인다. 실제 고객·직원 정보는 사용하지 않는다.
 *
 * 사용: node infra/preview/seed-demo.mjs <base-url> <service-accounts.json>
 * 환경: PREVIEW_BASIC_USER / PREVIEW_BASIC_PASS (Nginx 접근 인증), NODE_EXTRA_CA_CERTS (자체 서명 인증서)
 * 대표(OWNER) 계정은 사용하지 않는다. 대표에게 결재·업무·일정을 배정만 한다.
 */
import { createHmac } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const [BASE, ACCOUNTS_FILE] = process.argv.slice(2);
if (!BASE || !ACCOUNTS_FILE) {
  console.error('usage: seed-demo.mjs <base-url> <service-accounts.json>');
  process.exit(2);
}
const accounts = JSON.parse(readFileSync(ACCOUNTS_FILE, 'utf8'));
const basic = process.env.PREVIEW_BASIC_USER
  ? 'Basic ' + Buffer.from(`${process.env.PREVIEW_BASIC_USER}:${process.env.PREVIEW_BASIC_PASS}`).toString('base64')
  : null;

// ── TOTP (RFC 6238) ──
function totp(secret, offset = 0) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, value = 0; const bytes = [];
  for (const ch of secret.toUpperCase().replace(/=+$/, '')) {
    value = (value << 5) | A.indexOf(ch); bits += 5;
    if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  const c = Buffer.alloc(8); c.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + offset));
  const h = createHmac('sha1', Buffer.from(bytes)).update(c).digest(); const o = h[h.length - 1] & 15;
  return String((((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, '0');
}

// ── 세션 클라이언트 ──
function client() {
  const jar = new Map();
  let csrf = null;
  async function call(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (basic) headers.Authorization = basic;
    if (jar.size) headers.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    if (csrf && method !== 'GET') headers['X-CSRF-Token'] = csrf;
    const res = await fetch(BASE + '/api/v1' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const sc of res.headers.getSetCookie?.() ?? []) {
      const [kv] = sc.split(';'); const i = kv.indexOf('=');
      jar.set(kv.slice(0, i), kv.slice(i + 1));
    }
    const text = await res.text();
    let json = null; try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    return { status: res.status, body: json };
  }
  // 운영 수준 요청 제한(로그인·초대 수락 등)을 지키며 진행: 429 이면 대기 후 재시도
  async function callRetry(method, path, body) {
    for (let attempt = 0; ; attempt++) {
      const r = await call(method, path, body);
      if (r.status !== 429 || attempt >= 10) return r;
      await new Promise((ok) => setTimeout(ok, [2000, 4000, 8000][attempt] ?? 15_000));
    }
  }
  return {
    call,
    async login(email, password) {
      const r = await callRetry('POST', '/auth/login', { email, password });
      if (r.status !== 200) throw new Error(`login ${email} ${r.status} ${JSON.stringify(r.body)}`);
      csrf = r.body.csrfToken;
      return r.body;
    },
    async must(method, path, body) {
      const r = await callRetry(method, path, body);
      if (r.status >= 300) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
      return r.body;
    },
  };
}

/** 가상 경영진 로그인 + (필수 정책) MFA 등록/검증. 비밀키는 서비스 계정 파일에만 보관 */
async function signIn(persona) {
  const c = client();
  const r = await c.login(persona.email, persona.password);
  if (r.mfaEnrollmentRequired || (!r.mfaRequired && !persona.mfaSecret)) {
    const st = await c.must('POST', '/auth/mfa/enroll/start', { password: persona.password });
    persona.mfaSecret = st.secret;
    await c.must('POST', '/auth/mfa/enroll/confirm', { code: totp(st.secret) });
  } else if (r.mfaRequired) {
    // 같은 30초 구간 코드 재사용 방지를 피하기 위해 다음 단계 코드 사용
    await c.must('POST', '/auth/mfa/verify', { code: totp(persona.mfaSecret, 1) });
  }
  return c;
}

const log = (...a) => console.log('[seed-demo]', ...a);
const day = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return d.toISOString().slice(0, 10); };
const at = (offset, h, m = 0) => { const d = new Date(); d.setDate(d.getDate() + offset); d.setHours(h, m, 0, 0); return d.toISOString(); };
const items = (b) => (Array.isArray(b) ? b : b?.items ?? []);

async function main() {
  const OWNER = accounts.ownerUserId;
  const creator = await signIn(accounts.creator);
  const approver = await signIn(accounts.approver);
  writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2), { mode: 0o600 });

  // ── 조직: 부서·가상 직원 ──
  const roles = Object.fromEntries((await creator.must('GET', '/employees/roles')).map((r) => [r.key, r.id]));
  let depts = await creator.must('GET', '/directory/departments');
  if (!depts.find((d) => d.name === '디자인')) await creator.must('POST', '/departments', { name: '디자인', description: '[샘플] 브랜드·UX 디자인' });
  depts = Object.fromEntries((await creator.must('GET', '/directory/departments')).map((d) => [d.name, d.id]));
  const people = [
    ['이샘플', 'MANAGER', '콘텐츠', '콘텐츠 팀장'], ['박샘플', 'EMPLOYEE', '테크', '프론트엔드 개발자'],
    ['최샘플', 'EMPLOYEE', '브랜드전략', '브랜드 매니저'], ['강샘플', 'MANAGER', '디자인', '디자인 리드'],
    ['윤샘플', 'EMPLOYEE', '콘텐츠', 'PD'], ['조샘플', 'EMPLOYEE', '테크', '백엔드 개발자'],
    ['임샘플', 'GUEST', null, '외부 협력 (게스트)'],
  ];
  const existing = new Set((await creator.must('GET', '/directory/users')).map((u) => u.name));
  for (const [i, [name, role, dept, title]] of people.entries()) {
    if (existing.has(name)) continue;
    const inv = await creator.must('POST', '/employees/invitations', { email: `staff${i + 1}@preview.oogam.invalid`, name, roleId: roles[role], departmentId: dept ? depts[dept] : undefined, title });
    const token = new URL(inv.inviteUrl, 'https://x').searchParams.get('token');
    const anon = client();
    await anon.must('POST', '/auth/accept-invitation', { token, name, password: `Pv${Buffer.from(crypto.getRandomValues(new Uint8Array(12))).toString('base64url')}9` });
  }
  const users = Object.fromEntries((await creator.must('GET', '/directory/users')).map((u) => [u.name, u.id]));
  for (const [dept, mgr] of [['콘텐츠', '이샘플'], ['디자인', '강샘플'], ['경영지원', '정샘플']]) {
    await creator.call('PATCH', `/departments/${depts[dept]}`, { managerId: users[mgr] });
  }
  log('직원', Object.keys(users).length, '명');

  // ── 홈페이지 CMS ──
  const cmsPage = async (key, content) => {
    await creator.must('PUT', `/cms/pages/${key}`, { content });
    await creator.must('POST', `/cms/pages/${key}/publish`);
  };
  const home = (await creator.must('GET', '/cms/pages/home')).content ?? {};
  await cmsPage('home', { ...home, intro: { heading: '아이디어를 실행 가능한 임팩트로.', body: '[샘플 문구] OOGAM은 크리에이티브 비즈니스, 미디어, 테크놀로지를 하나의 흐름으로 연결해 브랜드의 다음 장면을 만듭니다.' } });
  await cmsPage('about', { heading: 'About OOGAM', body: '[샘플 문구] OOGAM은 브랜드 기획, 콘텐츠 제작, 기술 개발을 한 팀에서 수행하는 크리에이티브 컴퍼니입니다.\n\n아이디어가 실제 결과로 이어지도록 기획부터 운영까지 함께합니다. 이 문구는 Preview 검수용 샘플입니다.' });
  const biz = (await creator.must('GET', '/cms/pages/business')).content ?? {};
  await cmsPage('business', { ...biz, body: '[샘플 문구] 세 가지 사업 영역이 하나의 프로젝트 안에서 유기적으로 연결됩니다.' });
  await cmsPage('careers', { heading: 'Careers', body: '[샘플 문구] 좋은 아이디어를 끝까지 실행하는 동료를 찾습니다. 아래 공고는 Preview 검수용 가상 공고입니다.' });

  const publish = async (kind, id) => {
    await creator.call('POST', `/cms/${kind}/${id}/status`, { status: 'REVIEW' });
    await creator.must('POST', `/cms/${kind}/${id}/status`, { status: 'PUBLISHED' });
  };
  const brandIds = [];
  const brandsExisting = items(await creator.must('GET', '/cms/brands?pageSize=100'));
  for (const [i, [slug, name, cat, desc]] of [
    ['sample-studio', '샘플 스튜디오', '크리에이티브 스튜디오', '브랜드 기획과 영상 제작을 하는 가상의 크리에이티브 스튜디오입니다.'],
    ['sample-audio', '샘플 오디오', '오디오 콘텐츠', '오디오 콘텐츠를 기획하는 가상의 브랜드입니다.'],
    ['sample-live', '샘플 라이브', '라이브 미디어', '라이브 스트리밍 기반의 가상 미디어 브랜드입니다.'],
    ['sample-academy', '샘플 아카데미', '교육', '콘텐츠 제작 교육을 운영하는 가상의 브랜드입니다.'],
    ['sample-lab', '샘플 랩', '테크', '서비스 프로토타입을 만드는 가상의 테크 브랜드입니다.'],
    ['sample-goods', '샘플 굿즈', '커머스', '브랜드 굿즈를 기획하는 가상의 커머스 브랜드입니다.'],
  ].entries()) {
    const found = brandsExisting.find((b) => b.slug === slug);
    const b = found ?? (await creator.must('POST', '/cms/brands', { name, slug, category: cat, tagline: `${cat} · 가상 샘플`, description: `${desc} (Preview 검수용 샘플)`, sortOrder: i }));
    if (!found) await publish('brands', b.id);
    brandIds.push(b.id);
  }
  const pfExisting = items(await creator.must('GET', '/cms/portfolio?pageSize=100'));
  for (const [i, [slug, title, client_, year, tags]] of [
    ['sample-rebrand', '[샘플] 브랜드 리뉴얼 캠페인', '샘플 클라이언트 A', 2026, ['Branding', 'Campaign']],
    ['sample-docu', '[샘플] 다큐멘터리 시리즈', '샘플 클라이언트 B', 2025, ['Media', 'Film']],
    ['sample-platform', '[샘플] 커머스 플랫폼 구축', '샘플 클라이언트 C', 2026, ['Technology']],
    ['sample-edu', '[샘플] 크리에이터 교육 과정', '샘플 클라이언트 D', 2025, ['Education']],
  ].entries()) {
    if (pfExisting.find((p) => p.slug === slug)) continue;
    const p = await creator.must('POST', '/cms/portfolio', { title, slug, client: client_, year, tags, featured: i < 3, sortOrder: i, summary: 'Preview 검수를 위한 가상 프로젝트 소개 문구입니다.', brandId: brandIds[i] });
    await publish('portfolio', p.id);
  }
  const postsExisting = items(await creator.must('GET', '/cms/posts?pageSize=100'));
  for (const [type, slug, title, excerpt, meta] of [
    ['NEWS', 'sample-news-1', '[샘플] OOGAM 워크스페이스 오픈', '사내 협업 플랫폼을 오픈했다는 가상의 뉴스입니다.'],
    ['NEWS', 'sample-news-2', '[샘플] 파트너십 체결 소식', '가상의 파트너십 소식입니다.'],
    ['NEWS', 'sample-news-3', '[샘플] 연말 캠페인 공개', '가상의 캠페인 공개 소식입니다.'],
    ['INSIGHT', 'sample-insight-1', '[샘플] 크리에이티브와 기술의 만남', '가상의 인사이트 글입니다.'],
    ['CAREER', 'sample-career-1', '[샘플] 프로덕트 디자이너', '가상의 채용 공고입니다.', { location: '서울', employmentType: 'FULL_TIME', deadline: day(40), team: '디자인' }],
    ['CAREER', 'sample-career-2', '[샘플] 영상 PD (계약직)', '가상의 채용 공고입니다.', { location: '서울', employmentType: 'CONTRACT', deadline: day(25), team: '콘텐츠' }],
  ]) {
    if (postsExisting.find((p) => p.slug === slug)) continue;
    const body = { type, title, slug, excerpt, body: `## ${title}\n\n${excerpt}\n\n- Preview 검수용 샘플 본문입니다.\n- 실제 공지·공고가 아닙니다.` };
    if (meta) body.metadata = meta;
    const p = await creator.must('POST', '/cms/posts', body);
    await publish('posts', p.id);
  }
  // 문의 접수 (공개 폼 경유, 가상 연락처)
  for (const [i, [name, msg]] of [['가상 고객 A', '[샘플] 브랜드 리뉴얼 견적 문의드립니다.'], ['가상 파트너 B', '[샘플] 콘텐츠 협업 제안드립니다.']].entries()) {
    await client().must('POST', '/public/inquiries', { name, email: `inquiry${i + 1}@example.invalid`, category: 'PROJECT', message: msg, privacyConsent: true });
  }
  log('CMS: 브랜드·포트폴리오·뉴스·채용·고정 페이지 게시');

  // ── 프로젝트·업무 ──
  const projectsExisting = items(await creator.must('GET', '/projects?pageSize=50'));
  const proj = async (key, name, status, priority, start, end, members, desc) => {
    const found = projectsExisting.find((p) => p.key === key);
    if (found) return found;
    return creator.must('POST', '/projects', { key, name, status, priority, startDate: day(start), endDate: day(end), managerId: OWNER, memberIds: members, description: desc, departmentId: depts['브랜드전략'] });
  };
  const p1 = await proj('WEB', '[샘플] 브랜드 사이트 리뉴얼', 'ACTIVE', 'HIGH', -30, 45, [users['박샘플'], users['최샘플'], users['강샘플'], users['이샘플']], '가상 프로젝트: 공식 홈페이지 리뉴얼');
  const p2 = await proj('CAMP', '[샘플] 2027 캠페인 기획', 'PLANNING', 'MEDIUM', 10, 120, [users['이샘플'], users['윤샘플']], '가상 프로젝트: 연간 캠페인 기획');
  const p3 = await proj('EDU', '[샘플] 사내 교육 프로그램', 'ON_HOLD', 'LOW', -60, 30, [users['조샘플']], '가상 프로젝트: 사내 교육');
  const taskCount = (await creator.must('GET', `/tasks?projectId=${p1.id}&pageSize=100`)).total;
  if (!taskCount) {
    const ms1 = await creator.must('POST', `/projects/${p1.id}/milestones`, { name: '디자인 확정', dueDate: day(7) });
    await creator.must('POST', `/projects/${p1.id}/milestones`, { name: '오픈', dueDate: day(45) });
    const T = (title, status, priority, assignees, start, due, extra = {}) =>
      creator.must('POST', '/tasks', { projectId: p1.id, title, status, priority, assigneeIds: assignees, startDate: day(start), dueDate: day(due), ...extra });
    await T('정보 구조(IA) 확정', 'DONE', 'HIGH', [users['최샘플']], -28, -20);
    await T('디자인 시스템 토큰 정의', 'DONE', 'MEDIUM', [users['강샘플']], -20, -10);
    await T('메인 Hero 시안 검토', 'REVIEW', 'URGENT', [OWNER, users['강샘플']], -5, 1, { milestoneId: ms1.id, checklist: [{ id: 'a', text: 'A안', done: true }, { id: 'b', text: 'B안', done: true }, { id: 'c', text: '대표 의견 반영', done: false }] });
    await T('브랜드 페이지 카피 작성', 'IN_PROGRESS', 'HIGH', [users['최샘플']], -3, 4);
    await T('메인 페이지 개발', 'IN_PROGRESS', 'HIGH', [users['박샘플']], -7, 10);
    await T('반응형 QA', 'TODO', 'MEDIUM', [users['박샘플'], users['조샘플']], 8, 14);
    await T('오픈 일정 최종 승인', 'TODO', 'URGENT', [OWNER], 12, 20);
    await T('뉴스 콘텐츠 3건 준비', 'TODO', 'LOW', [users['윤샘플']], 5, 18);
    await creator.must('POST', '/tasks', { projectId: p2.id, title: '캠페인 콘셉트 브레인스토밍', status: 'TODO', priority: 'MEDIUM', assigneeIds: [users['이샘플'], OWNER], dueDate: day(9) });
    await creator.must('POST', '/tasks', { projectId: p2.id, title: '예산안 초안', status: 'IN_PROGRESS', priority: 'HIGH', assigneeIds: [users['윤샘플']], dueDate: day(6) });
    await creator.must('POST', '/tasks', { projectId: p3.id, title: '교육 커리큘럼 정리', status: 'REVIEW', priority: 'LOW', assigneeIds: [users['조샘플']], dueDate: day(-2) });
  }
  log('프로젝트 3건, 업무 배정 (대표 담당 업무 포함)');

  // ── 문서 ──
  const docsExisting = items(await creator.must('GET', '/documents?pageSize=50'));
  if (!docsExisting.find((d) => d.title === '[샘플] 주간 회의록')) {
    const T = (s) => ({ type: 'text', text: s });
    const P = (s) => ({ type: 'paragraph', content: [T(s)] });
    const H = (l, s) => ({ type: 'heading', attrs: { level: l }, content: [T(s)] });
    const li = (s) => ({ type: 'listItem', content: [P(s)] });
    const task = (s, d) => ({ type: 'taskItem', attrs: { checked: d }, content: [P(s)] });
    const cell = (s, h) => ({ type: h ? 'tableHeader' : 'tableCell', content: [P(s)] });
    const doc = await creator.must('POST', '/documents', { title: '[샘플] 주간 회의록', icon: '🗒️' });
    await creator.must('PUT', `/documents/${doc.id}/content`, { baseVersion: doc.version ?? 1, content: { type: 'doc', content: [
      { type: 'callout', attrs: { emoji: '📌' }, content: [P('Preview 검수용 가상 문서입니다. 자유롭게 수정해 보세요. 입력하면 자동 저장됩니다.')] },
      H(2, '안건'), { type: 'bulletList', content: [li('브랜드 사이트 리뉴얼 진행 현황'), li('2027 캠페인 일정 검토'), li('워크스페이스 사용 교육')] },
      H(2, '결정 사항'), { type: 'orderedList', content: [li('메인 Hero 시안은 B안으로 확정'), li('2주 뒤 1차 QA 완료')] },
      H(2, '액션 아이템'), { type: 'taskList', content: [task('Hero 반응형 점검 — 박샘플', true), task('브랜드 카피 검수 — 최샘플', false), task('오픈 일정 승인 — 대표', false)] },
      H(2, '일정'), { type: 'table', content: [
        { type: 'tableRow', content: [cell('단계', 1), cell('담당', 1), cell('마감', 1)] },
        { type: 'tableRow', content: [cell('디자인 확정'), cell('강샘플'), cell(day(7))] },
        { type: 'tableRow', content: [cell('개발'), cell('박샘플'), cell(day(30))] },
        { type: 'tableRow', content: [cell('오픈'), cell('대표 승인'), cell(day(45))] }] },
      { type: 'toggle', content: [{ type: 'toggleSummary', content: [T('지난 회의 요약 (펼치기)')] }, { type: 'toggleContent', content: [P('와이어프레임을 검토했습니다.')] }] },
    ] } });
    await creator.call('POST', `/projects/${p1.id}/links`, { targetType: 'PAGE', targetId: doc.id });
    const guide = await creator.must('POST', '/documents', { title: '[샘플] 브랜드 가이드 초안', icon: '🎨' });
    await creator.must('PUT', `/documents/${guide.id}/content`, { baseVersion: guide.version ?? 1, content: { type: 'doc', content: [H(2, '로고 사용 원칙'), P('가상 가이드 문서입니다.'), H(2, '컬러'), { type: 'bulletList', content: [li('Black #0A0A0A'), li('White #FFFFFF')] }] } });
    await creator.must('POST', '/documents', { title: '[샘플] 컬러 세부 규정', parentId: guide.id });
    await creator.must('POST', '/documents', { title: '[샘플] 신규 입사자 온보딩' });
  }
  log('문서 4건');

  // ── 데이터베이스 ──
  const dbsExisting = items(await creator.must('GET', '/databases'));
  if (!dbsExisting.find((d) => d.name === '[샘플] 콘텐츠 캘린더')) {
    const db = await creator.must('POST', '/databases', { name: '[샘플] 콘텐츠 캘린더', description: '가상 콘텐츠 발행 일정', icon: '📅' });
    const full = await creator.must('GET', `/databases/${db.id}`);
    const title = full.properties.find((p) => p.type === 'TITLE');
    const opt = (names) => names.map((n, i) => ({ id: `o${i}`, name: n }));
    const st = await creator.must('POST', `/databases/${db.id}/properties`, { name: '상태', type: 'SELECT', config: { options: opt(['기획', '제작', '검수', '발행']) } });
    const ch = await creator.must('POST', `/databases/${db.id}/properties`, { name: '채널', type: 'MULTI_SELECT', config: { options: opt(['홈페이지', '인스타그램', '유튜브', '뉴스레터']) } });
    const who = await creator.must('POST', `/databases/${db.id}/properties`, { name: '담당자', type: 'PERSON' });
    const date = await creator.must('POST', `/databases/${db.id}/properties`, { name: '게시일', type: 'DATE' });
    const done = await creator.must('POST', `/databases/${db.id}/properties`, { name: '확정', type: 'CHECKBOX' });
    const rows = [
      ['11월 뉴스레터', 'o3', ['o3'], '윤샘플', 2, true], ['브랜드 인터뷰 영상', 'o1', ['o2'], '이샘플', 9, false],
      ['연말 캠페인 티저', 'o0', ['o1', 'o2'], '최샘플', 20, false], ['채용 카드뉴스', 'o3', ['o1'], '강샘플', -3, true],
      ['포트폴리오 업데이트', 'o2', ['o0'], '박샘플', 5, false], ['파트너 인터뷰', 'o0', ['o0', 'o3'], '이샘플', 27, false],
    ];
    for (const [t, s, c, p, d, ok] of rows) {
      await creator.must('POST', `/databases/${db.id}/rows`, { cells: { [title.id]: `[샘플] ${t}`, [st.id]: s, [ch.id]: c, [who.id]: [users[p]], [date.id]: { start: day(d) }, [done.id]: ok } });
    }
    await creator.must('POST', `/databases/${db.id}/views`, { name: '보드', type: 'BOARD', config: { groupBy: st.id } });
    await creator.must('POST', `/databases/${db.id}/views`, { name: '캘린더', type: 'CALENDAR', config: { datePropertyId: date.id } });
    await creator.must('POST', `/databases/${db.id}/views`, { name: '갤러리', type: 'GALLERY', config: {} });
  }
  log('데이터베이스 1개 (속성 6, 행 6, 보기 4)');

  // ── 캘린더 ──
  const evExisting = items(await creator.must('GET', `/calendar/events?from=${at(-40, 0)}&to=${at(60, 0)}`));
  if (!evExisting.some((e) => String(e.title).includes('[샘플]'))) {
    const E = (title, s, h1, e, h2, attendees, extra = {}) => creator.must('POST', '/calendar/events', { title, startAt: at(s, h1), endAt: at(e, h2), attendeeIds: attendees, ...extra });
    await E('[샘플] 주간 전체 회의', 1, 10, 1, 11, [OWNER, users['이샘플'], users['강샘플'], users['박샘플']], { location: '대회의실' });
    await E('[샘플] 클라이언트 미팅 (가상)', 3, 14, 3, 15, [OWNER, users['최샘플']], { location: '외부' });
    await E('[샘플] 디자인 리뷰', 6, 16, 6, 17, [OWNER, users['강샘플']]);
    await E('[샘플] 팀 워크숍', 12, 0, 13, 0, [users['이샘플'], users['윤샘플']], { allDay: true });
    await E('[샘플] 월간 경영 보고', 15, 9, 15, 10, [OWNER, accounts.approver.userId]);
  }
  log('일정 5건');

  // ── 재무 (작성: 정샘플 → 승인: 한샘플, 직무 분리) ──
  const units = Object.fromEntries(items(await creator.must('GET', '/finance/business-units')).map((u) => [u.code, u.id]));
  const year = new Date().getFullYear();
  const budgets = items(await creator.must('GET', `/finance/budgets?fiscalYear=${year}`));
  if (!budgets.find((b) => b.name.includes('[샘플]'))) {
    const b = await creator.must('POST', '/finance/budgets', { name: `[샘플] ${year} 마케팅 예산`, fiscalYear: year, period: 'ANNUAL', businessUnitId: units.CREATIVE,
      lines: [{ category: '광고비', plannedAmount: '30000000' }, { category: '콘텐츠 제작', plannedAmount: '20000000' }, { category: '행사', plannedAmount: '10000000' }] });
    await creator.must('POST', `/finance/budgets/${b.id}/submit`);
    await approver.must('POST', `/finance/budgets/${b.id}/approve`, { comment: '[샘플] 승인' });
    const b2 = await creator.must('POST', '/finance/budgets', { name: `[샘플] ${year} 기술 인프라 예산`, fiscalYear: year, period: 'ANNUAL', businessUnitId: units.TECH,
      lines: [{ category: '클라우드', plannedAmount: '12000000' }, { category: '소프트웨어', plannedAmount: '6000000' }] });
    await creator.must('POST', `/finance/budgets/${b2.id}/submit`);
  }
  const txs = items(await creator.must('GET', '/finance/transactions?pageSize=100'));
  if (!txs.some((t) => String(t.description).includes('[샘플]'))) {
    const rows = [
      [-120, 'REVENUE', 'CREATIVE', '샘플 클라이언트 A', '브랜드 컨설팅 1차', '18000000', true], [-95, 'REVENUE', 'MEDIA', '샘플 클라이언트 B', '영상 제작', '12500000', true],
      [-70, 'REVENUE', 'TECH', '샘플 클라이언트 C', '플랫폼 구축 착수금', '30000000', true], [-40, 'REVENUE', 'CREATIVE', '샘플 클라이언트 A', '브랜드 컨설팅 2차', '22000000', true],
      [-10, 'REVENUE', 'EDU', '샘플 교육기관', '크리에이터 교육', '8000000', true],
      [-110, 'EXPENSE', 'MEDIA', '샘플 장비렌탈', '촬영 장비 대여', '3200000', true], [-80, 'EXPENSE', 'TECH', '샘플 클라우드', '서버 비용', '1800000', true],
      [-50, 'EXPENSE', 'CREATIVE', '샘플 디자인 스튜디오', '외주 디자인', '6500000', true], [-20, 'EXPENSE', 'EDU', '샘플 교육센터', '강의실 대관', '900000', true],
      [-4, 'EXPENSE', 'MEDIA', '샘플 인쇄소', '홍보물 인쇄', '1400000', false], [-2, 'EXPENSE', 'CREATIVE', '샘플 광고대행사', '온라인 광고 집행', '5200000', false],
    ];
    for (const [d, type, unit, cp, desc, amt, approve] of rows) {
      const t = await creator.must('POST', '/finance/transactions', { txDate: day(d), type, businessUnitId: units[unit], projectId: type === 'EXPENSE' && unit !== 'EDU' ? p1.id : undefined, counterparty: cp, description: `[샘플] ${desc}`, supplyAmount: amt, autoVat: true, submit: true });
      if (approve) await approver.must('POST', `/finance/transactions/${t.id}/approve`, {});
    }
  }
  log('예산 2건(승인 1·심사 1), 거래 11건(승인 9·대기 2)');

  // ── 전자결재 ──
  const aprs = items(await creator.must('GET', '/approvals?box=all&pageSize=50'));
  if (!aprs.some((a) => String(a.title).includes('[샘플]'))) {
    // 대표 결재 대기 2건
    await creator.must('POST', '/approvals', { type: 'PURCHASE', title: '[샘플] 촬영 장비 구매 품의', content: '가상 품의: 4K 카메라 1대 구매', amount: '4800000', approverIds: [OWNER], submit: true, projectId: p1.id });
    await creator.must('POST', '/approvals', { type: 'CONTRACT', title: '[샘플] 외주 개발 계약 검토', content: '가상 계약 검토 요청', approverIds: [accounts.approver.userId, OWNER], submit: true });
    // 완료 1건, 반려 1건, 임시저장 1건
    const a3 = await creator.must('POST', '/approvals', { type: 'EXPENSE', title: '[샘플] 워크숍 비용 지출 결의', content: '가상 지출 결의', amount: '1200000', approverIds: [accounts.approver.userId], submit: true });
    await approver.must('POST', `/approvals/${a3.id}/approve`, { comment: '[샘플] 승인합니다.', version: a3.version });
    const a4 = await creator.must('POST', '/approvals', { type: 'GENERAL', title: '[샘플] 사무실 이전 검토', content: '가상 품의', approverIds: [accounts.approver.userId], submit: true });
    await approver.call('POST', `/approvals/${a4.id}/reject`, { comment: '[샘플] 시기 재검토 필요', version: a4.version });
    await creator.must('POST', '/approvals', { type: 'LEAVE', title: '[샘플] 연차 신청 (임시저장)', content: '가상 휴가 신청', approverIds: [accounts.approver.userId], submit: false });
  }
  log('결재 5건 (대표 결재 대기 포함)');

  // ── 공지 ──
  const ann = items(await creator.must('GET', '/announcements?pageSize=20'));
  if (!ann.some((a) => String(a.title).includes('[샘플]'))) {
    await creator.must('POST', '/announcements', { title: '[샘플] Preview 사이트 안내', body: '이 사이트는 대표 검수용 Preview 입니다. 모든 데이터는 가상이며 자유롭게 수정해도 됩니다.', scope: 'COMPANY', pinned: true });
    await creator.must('POST', '/announcements', { title: '[샘플] 11월 전체 회의 일정', body: '가상 공지입니다.', scope: 'COMPANY' });
    await creator.must('POST', '/announcements', { title: '[샘플] 콘텐츠팀 장비 점검', body: '가상 부서 공지입니다.', scope: 'DEPARTMENT', departmentId: depts['콘텐츠'] });
  }
  log('공지 3건');
  writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2), { mode: 0o600 });
  log('완료');
}

main().catch((e) => { console.error('[seed-demo] 실패:', e.message); process.exit(1); });
