'use client';
import { UploadCloud } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { ACCEPT_ATTR, uploadFile, type UploadedFile } from './upload';

/** 드래그&드롭 / 클릭 업로드 영역. 여러 파일을 순차 업로드한다 */
export function UploadZone({
  target, onUploaded, className, compact,
}: {
  target?: { targetType: string; targetId: string };
  onUploaded?: (f: UploadedFile) => void;
  className?: string;
  compact?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const handle = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (!list.length) return;
    setProgress({ done: 0, total: list.length });
    let ok = 0;
    for (const [i, f] of list.entries()) {
      try {
        const up = await uploadFile(f, target);
        ok += 1;
        onUploaded?.(up);
      } catch (e) {
        toast.error(`${f.name}: ${(e as Error).message}`);
      }
      setProgress({ done: i + 1, total: list.length });
    }
    setProgress(null);
    if (ok) toast.success(`${ok}개 파일을 업로드했습니다.`);
    if (input.current) input.current.value = '';
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="파일 업로드"
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
      onClick={() => !progress && input.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); void handle(e.dataTransfer.files); }}
      className={cn(
        'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border text-center transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20',
        compact ? 'px-4 py-5' : 'px-6 py-10',
        drag && 'border-foreground bg-muted',
        className,
      )}
    >
      <UploadCloud className="size-6 text-muted-foreground" strokeWidth={1.5} />
      {progress ? (
        <p className="text-sm">업로드 중… {progress.done}/{progress.total}</p>
      ) : (
        <>
          <p className="text-sm font-medium">파일을 끌어다 놓거나 클릭해 선택하세요</p>
          <p className="text-xs text-muted-foreground">이미지, PDF, 오피스·한글 문서, 텍스트, CSV, ZIP</p>
        </>
      )}
      <input ref={input} type="file" multiple accept={ACCEPT_ATTR} className="hidden" onChange={(e) => e.target.files && void handle(e.target.files)} />
    </div>
  );
}
