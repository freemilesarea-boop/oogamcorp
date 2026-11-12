-- OOGAM CMS 관리자 비밀번호 설정 링크 발급 (Supabase SQL Editor 에서 대표자가 직접 실행)
-- - 토큰은 이 쿼리 안에서 무작위 생성되며, DB 에는 SHA-256 해시만 저장된다.
-- - 결과로 나온 링크는 2시간 동안 1회만 사용할 수 있다. 다른 사람에게 전달하지 말 것.
-- - 실행하면 해당 계정의 기존 비밀번호는 즉시 무효화되고 로그인 세션도 모두 종료된다.
-- - 이메일을 바꾸려면 아래 'ceo@oogam.co.kr' 두 곳을 수정한다 (OWNER 역할 계정에만 사용).
begin;

update oogam.users
   set "passwordHash" = null, status = 'INVITED', "failedLoginCount" = 0, "lockedUntil" = null, "updatedAt" = now()
 where email = 'ceo@oogam.co.kr';
update oogam.sessions s set "revokedAt" = now(), "updatedAt" = now()
  from oogam.users u where u.id = s."userId" and u.email = 'ceo@oogam.co.kr' and s."revokedAt" is null;
update oogam.invitations set "revokedAt" = now(), "updatedAt" = now()
 where email = 'ceo@oogam.co.kr' and "acceptedAt" is null and "revokedAt" is null;

with t as (
  select replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '') as tok
), ins as (
  insert into oogam.invitations (id, "organizationId", email, name, "roleId", title, "tokenHash", "invitedById", "expiresAt", "createdAt", "updatedAt")
  select gen_random_uuid(), o.id, u.email, u.name, r.id, '대표', encode(sha256(convert_to(t.tok, 'UTF8')), 'hex'), u.id,
         now() + interval '2 hours', now(), now()
    from t
    join oogam.organizations o on o.slug = 'oogam'
    join oogam.roles r on r."organizationId" = o.id and r.key = 'OWNER'
    join oogam.users u on u.email = 'ceo@oogam.co.kr'
  returning id
)
select 'https://oogam.co.kr/admin/accept-invite?token=' || t.tok as setup_link, (select count(*) from ins) as created
  from t;

commit;
