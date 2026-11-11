import { draftMode } from 'next/headers';
import type { NextRequest } from 'next/server';
import { relativeRedirect, safePreviewPath } from '@/lib/preview-path';

export const dynamic = 'force-dynamic';

/** 미리보기 종료 → 공개본 */
export async function GET(req: NextRequest) {
  (await draftMode()).disable();
  return relativeRedirect(safePreviewPath(req.nextUrl.searchParams.get('path')));
}
