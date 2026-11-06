'use client';
import { Database as DatabaseIcon, Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { EmptyState, ErrorState, LoadingRows, PageHeader, Pagination } from '@/components/admin/states';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { apiPost } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { timeAgo } from '@/lib/utils';
import { useDatabases } from './api';

function CreateDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('');
  const [description, setDescription] = useState('');
  const create = useMutation({
    mutationFn: () => apiPost<{ id: string }>('/databases', { name: name.trim(), ...(icon.trim() ? { icon: icon.trim() } : {}), ...(description.trim() ? { description: description.trim() } : {}) }),
    onSuccess: (db) => {
      void qc.invalidateQueries({ queryKey: ['databases'] });
      toast.success('데이터베이스를 만들었습니다.');
      router.push(`/admin/databases/${db.id}`);
    },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) create.mutate(); }} className="space-y-4">
          <DialogHeader>
            <DialogTitle>새 데이터베이스</DialogTitle>
            <DialogDescription>기본 워크스페이스에 만들어지며, &lsquo;이름&rsquo; 제목 속성과 표 보기가 자동으로 생성됩니다.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-[5rem_1fr] gap-3">
            <Field label="아이콘" htmlFor="db-icon"><Input id="db-icon" value={icon} onChange={(e) => setIcon(e.target.value)} maxLength={16} placeholder="📋" /></Field>
            <Field label="이름" htmlFor="db-name"><Input id="db-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} required autoFocus /></Field>
          </div>
          <Field label="설명 (선택)" htmlFor="db-desc"><Textarea id="db-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} rows={3} /></Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>취소</Button>
            <Button type="submit" loading={create.isPending}>만들기</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DatabaseList() {
  const can = useCan();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const list = useDatabases({ q: q.trim() || undefined, page, pageSize: 24 });
  const canWrite = can('databases.write');

  return (
    <>
      <PageHeader
        title="데이터베이스"
        description="표·보드·캘린더로 팀의 구조화된 정보를 관리하세요."
        actions={canWrite && <Button onClick={() => setOpen(true)}><Plus />새 데이터베이스</Button>}
      />
      <div className="relative mb-4 max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="이름 또는 설명 검색" aria-label="데이터베이스 검색" className="pl-9" />
      </div>
      {list.isLoading ? (
        <LoadingRows />
      ) : list.error ? (
        <ErrorState error={list.error} />
      ) : list.data && list.data.items.length === 0 ? (
        <EmptyState
          icon={DatabaseIcon}
          title={q ? '검색 결과가 없습니다' : '아직 데이터베이스가 없습니다'}
          description={q ? undefined : '콘텐츠 일정, 거래처 목록, 장비 관리 등 필요한 정보를 데이터베이스로 정리해 보세요.'}
          action={!q && canWrite ? <Button onClick={() => setOpen(true)}><Plus />새 데이터베이스</Button> : undefined}
        />
      ) : (
        <>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {list.data?.items.map((d) => (
              <li key={d.id}>
                <Link href={`/admin/databases/${d.id}`} className="flex h-full flex-col rounded-lg border border-border bg-card p-4 transition-colors hover:border-foreground/30 hover:bg-muted/30">
                  <span className="flex items-center gap-2 font-medium">
                    <span aria-hidden className="text-lg">{d.icon || '🗂️'}</span>
                    <span className="truncate">{d.name}</span>
                  </span>
                  {d.description && <span className="mt-1 line-clamp-2 text-sm text-muted-foreground">{d.description}</span>}
                  <span className="mt-auto pt-3 text-xs text-muted-foreground">
                    {d.rowCount.toLocaleString()}개 항목 · 속성 {d.propertyCount}개 · {d.workspace.name} · {timeAgo(d.updatedAt)} 수정
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {list.data && <Pagination page={list.data.page} totalPages={list.data.totalPages} onChange={setPage} />}
        </>
      )}
      <CreateDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
