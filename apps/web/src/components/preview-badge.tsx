import { isPreview } from '@/lib/site-mode';

/** Preview 빌드에서만 표시: 정식 서비스가 아니며 데이터가 가상임을 모든 화면에 고지 */
export function PreviewBadge() {
  if (!isPreview) return null;
  return (
    <div
      role="note"
      aria-label="미리보기 사이트 안내"
      className="pointer-events-none fixed bottom-3 left-1/2 z-[90] -translate-x-1/2 rounded-full bg-accent px-3.5 py-1.5 text-[11px] font-semibold tracking-wide text-white shadow-lg"
      style={{ marginBottom: 'env(safe-area-inset-bottom, 0px)' }}
      data-testid="preview-badge"
    >
      PREVIEW · 디자인 검수용 · 모든 데이터는 가상입니다
    </div>
  );
}
