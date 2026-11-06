'use client';
import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { formatDateTime } from '@/lib/utils';
import type { InviteResult } from './types';

/** 1회성 초대 링크 표시 + 복사 (SMTP 미설정 시 관리자가 직접 전달) */
export function InviteLinkBox({ result }: { result: InviteResult }) {
  const [copied, setCopied] = useState(false);
  const url = typeof window !== 'undefined' ? `${window.location.origin}${result.inviteUrl}` : result.inviteUrl;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('클립보드에 복사하지 못했습니다. 링크를 직접 선택해 복사하세요.');
    }
  };
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border bg-muted/40 p-3">
        <p className="mb-1.5 text-xs font-medium text-muted-foreground">{result.email} 초대 링크</p>
        <div className="flex items-center gap-2">
          <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label="초대 링크" className="h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-2 font-mono text-xs" />
          <Button type="button" size="sm" variant={copied ? 'secondary' : 'default'} onClick={copy}>
            {copied ? <Check /> : <Copy />}{copied ? '복사됨' : '복사'}
          </Button>
        </div>
      </div>
      <ul className="space-y-1 text-xs text-muted-foreground">
        <li>· 이 링크는 지금 한 번만 표시됩니다. 창을 닫으면 다시 볼 수 없으며, 필요하면 ‘재발송’으로 새 링크를 만드세요.</li>
        <li>· 만료: {formatDateTime(result.expiresAt)} (7일)</li>
        <li>· {result.emailQueued ? '초대 메일 발송을 요청했습니다.' : '메일 서버(SMTP)가 설정되지 않아 이메일은 발송되지 않았습니다. 링크를 안전한 경로로 직접 전달하세요.'}</li>
      </ul>
    </div>
  );
}
