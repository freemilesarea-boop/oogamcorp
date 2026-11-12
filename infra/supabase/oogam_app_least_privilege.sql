-- OOGAM 홈페이지 CMS 배포(Vercel) 전용 DB 역할 oogam_app — 최소 권한 + RLS (재실행 가능)
-- 근거: apps/api/src/serverless 가 로드하는 모듈(인증·CMS·공개 사이트·알림)의 Prisma 사용 내역.
-- 사내 업무 테이블(재무·인사·결재·문서·프로젝트·파일 등)에는 어떤 권한도 주지 않는다.
-- 실행: Supabase SQL Editor 또는 apply_migration (postgres 권한). 비밀번호는 여기서 설정하지 않는다.

revoke all on all tables in schema oogam from oogam_app;
alter default privileges for role postgres in schema oogam revoke all on tables from oogam_app;
revoke all on all tables in schema oogam from anon, authenticated;
revoke all on schema oogam from anon, authenticated, public;
grant usage on schema oogam to oogam_app;

-- 읽기 전용 (조직·역할·권한 정책)
grant select on oogam.organizations, oogam.roles, oogam.permissions, oogam.role_permissions,
  oogam.departments, oogam.resource_grants, oogam.workspaces to oogam_app;
-- 추가 전용 (감사 로그·변경 이력: 수정·삭제 불가)
grant select, insert on oogam.audit_logs, oogam.cms_revisions to oogam_app;
-- 초대 수락(1회용 토큰 소비)
grant select, update on oogam.invitations to oogam_app;
-- 계정·세션·CMS 콘텐츠 (삭제는 소프트 삭제 = UPDATE)
grant select, insert, update on oogam.users, oogam.memberships, oogam.sessions, oogam.workspace_members,
  oogam.website_pages, oogam.website_posts, oogam.brands, oogam.portfolio_items, oogam.business_areas, oogam.cms_media to oogam_app;
-- 실제 삭제가 필요한 항목 (문의 삭제·알림 정리·MFA 복구코드 재발급)
grant select, insert, update, delete on oogam.contact_inquiries, oogam.notifications, oogam.mfa_recovery_codes to oogam_app;

-- RLS: 모든 테이블에 활성화. oogam_app 은 권한을 받은 테이블에서만 정책으로 허용,
-- anon/authenticated 등 그 밖의 역할은 정책이 없으므로 권한이 잘못 부여되더라도 행이 보이지 않는다.
do $$
declare t text;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'oogam' and c.relkind = 'r' loop
    execute format('alter table oogam.%I enable row level security', t);
    execute format('drop policy if exists oogam_app_access on oogam.%I', t);
    if exists (select 1 from information_schema.role_table_grants g where g.table_schema = 'oogam' and g.table_name = t and g.grantee = 'oogam_app') then
      execute format('create policy oogam_app_access on oogam.%I for all to oogam_app using (true) with check (true)', t);
    end if;
  end loop;
end $$;
