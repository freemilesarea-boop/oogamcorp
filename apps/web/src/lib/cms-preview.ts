import 'server-only';
import { cookies, draftMode } from 'next/headers';
import { cache } from 'react';
import { loadBackend } from './cms-backend';
import { isCmsSite } from './site-mode';

/**
 * 발행 전 미리보기 여부. Next draftMode 쿠키만으로는 신뢰하지 않고,
 * 매 요청 세션을 다시 확인한다 (만료·폐기·MFA 미완료·권한 회수 시 즉시 공개본으로 복귀).
 */
export const previewViewer = cache(async (): Promise<{ name: string } | null> => {
  if (!isCmsSite) return null;
  try {
    if (!(await draftMode()).isEnabled) return null;
  } catch {
    return null; // 요청 컨텍스트 밖 (빌드 등)
  }
  const jar = await cookies();
  const token = jar.get('__Host-oogam_session')?.value ?? jar.get('oogam_session')?.value;
  if (!token) return null;
  try {
    const auth = await (await loadBackend()).resolveSession(token);
    if (!auth || !auth.permissions.has('cms.read') || !auth.permissions.has('workspace.access')) return null;
    if (auth.mfa.enabled && !auth.mfa.verified) return null;
    if (auth.mfa.required && !auth.mfa.enabled) return null;
    return { name: auth.name };
  } catch {
    return null;
  }
});
