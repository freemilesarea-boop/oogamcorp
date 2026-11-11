import { cookies, draftMode } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { loadBackend } from '@/lib/cms-backend';
import { relativeRedirect, safePreviewPath } from '@/lib/preview-path';
import { isCmsSite } from '@/lib/site-mode';

export const dynamic = 'force-dynamic';

/** 발행 전 미리보기 시작: cms.read 세션(MFA 완료) 확인 후 draftMode 활성화 */
export async function GET(req: NextRequest) {
  if (!isCmsSite) return new NextResponse('Not Found', { status: 404 });
  const path = safePreviewPath(req.nextUrl.searchParams.get('path'));
  const jar = await cookies();
  const token = jar.get('__Host-oogam_session')?.value ?? jar.get('oogam_session')?.value;
  const auth = token ? await (await loadBackend()).resolveSession(token).catch(() => null) : null;
  const ok = !!auth && auth.permissions.has('cms.read') && auth.permissions.has('workspace.access')
    && !(auth.mfa.enabled && !auth.mfa.verified) && !(auth.mfa.required && !auth.mfa.enabled);
  if (!ok) {
    return relativeRedirect(`/admin/login?next=${encodeURIComponent(`/admin/preview?path=${encodeURIComponent(path)}`)}`);
  }
  (await draftMode()).enable();
  return relativeRedirect(path);
}
