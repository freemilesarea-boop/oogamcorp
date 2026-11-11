import { draftMode } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { safePreviewPath } from '@/lib/preview-path';

export const dynamic = 'force-dynamic';

/** 미리보기 종료 → 공개본 */
export async function GET(req: NextRequest) {
  (await draftMode()).disable();
  return NextResponse.redirect(new URL(safePreviewPath(req.nextUrl.searchParams.get('path')), req.nextUrl.origin), { headers: { 'Cache-Control': 'no-store' } });
}
