'use client';
import { ChevronLeft, Download, MoreHorizontal, Plus, Save, Search, Upload } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { DevStatus, EmptyState, ErrorState, LoadingRows, Pagination } from '@/components/admin/states';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useDatabase, useDbMutations, useRows } from './api';
import { BoardView } from './board-view';
import { ImportDialog, ViewDialog } from './dialogs';
import { ViewControls } from './filter-sort';
import { CalendarView, GalleryView, ListView } from './other-views';
import { PropertyDialog } from './property-dialog';
import { RowDialog } from './row-dialog';
import { TableView } from './table-view';
import { NO_VALUE_OPERATORS, VIEW_TYPE_LABELS, type DbProperty, type DbView, type ViewConfig } from './types';

const merge = (v: DbView): ViewConfig => {
  const pref = v.preference ?? {};
  const clean = Object.fromEntries(Object.entries(pref).filter(([, x]) => x !== undefined && x !== null));
  return { ...v.config, ...clean };
};
const strip = (c: ViewConfig): ViewConfig => JSON.parse(JSON.stringify(c, (_k, v) => (v === null ? undefined : v)));

export function DatabasePage({ id }: { id: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const db = useDatabase(id);
  const mutations = useDbMutations(id);
  const [viewId, setViewId] = useState<string | null>(params.get('view'));
  const [draft, setDraft] = useState<ViewConfig>({});
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [propDialog, setPropDialog] = useState<{ open: boolean; prop: DbProperty | null }>({ open: false, prop: null });
  const [viewDialog, setViewDialog] = useState<{ open: boolean; view: DbView | null }>({ open: false, view: null });
  const [importOpen, setImportOpen] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const openRowId = params.get('row');

  const views = useMemo(() => db.data?.views ?? [], [db.data]);
  const view = views.find((v) => v.id === viewId) ?? views[0];
  const properties = useMemo(() => db.data?.properties ?? [], [db.data]);
  const canEdit = !!db.data?.access.canEdit;

  // 뷰 전환 시 저장된 설정(+개인 설정)으로 초안 초기화
  const baseline = useMemo(() => (view ? merge(view) : {}), [view]);
  const baselineKey = `${view?.id}:${JSON.stringify(baseline)}`;
  useEffect(() => {
    setDraft(baseline);
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 저장된 설정 내용이 바뀔 때만 초기화 (refetch 로 인한 참조 변경 무시)
  }, [baselineKey]);
  const dirty = JSON.stringify(strip(draft)) !== JSON.stringify(strip(baseline));

  const setUrl = (key: string, value: string | null) => {
    const sp = new URLSearchParams(params.toString());
    if (value) sp.set(key, value);
    else sp.delete(key);
    router.replace(`${pathname}${sp.toString() ? `?${sp}` : ''}`, { scroll: false });
  };
  const selectView = (vid: string) => {
    setViewId(vid);
    setUrl('view', vid);
  };

  const bulk = view && ['BOARD', 'CALENDAR', 'GALLERY', 'TIMELINE'].includes(view.type);
  const groupProp = useMemo(() => {
    if (!view) return undefined;
    const g = properties.find((p) => p.id === draft.groupBy);
    if (view.type === 'BOARD') return g?.type === 'SELECT' ? g : properties.find((p) => p.type === 'SELECT');
    return view.type === 'TABLE' ? g : undefined;
  }, [view, draft.groupBy, properties]);
  const dateProp = useMemo(
    () => properties.find((p) => p.id === draft.datePropertyId && p.type === 'DATE') ?? properties.find((p) => p.type === 'DATE'),
    [properties, draft.datePropertyId],
  );
  const completeFilters = (draft.filters ?? []).filter((f) => NO_VALUE_OPERATORS.includes(f.operator) || (f.value !== undefined && f.value !== ''));
  const rows = useRows(id, {
    filters: completeFilters,
    filterMode: draft.filterMode,
    sorts: draft.sorts,
    q: q.trim() || undefined,
    page: bulk ? 1 : page,
    pageSize: bulk ? 500 : 50,
  }, !!view && view.type !== 'TIMELINE');

  const visible = useMemo(() => {
    const vis = draft.visibleProperties;
    return vis ? properties.filter((p) => p.type === 'TITLE' || vis.includes(p.id)) : properties;
  }, [properties, draft.visibleProperties]);

  const openRow = (rid: string) => setUrl('row', rid);

  if (db.isLoading) return <LoadingRows rows={8} />;
  if (db.error) return <ErrorState error={db.error} />;
  if (!db.data || !view) return null;
  const d = db.data;

  const saveShared = () => mutations.updateView.mutate({ viewId: view.id, config: strip(draft) }, { onSuccess: () => toast.success('뷰 설정을 저장했습니다.') });
  const savePersonal = () => mutations.savePreference.mutate({ viewId: view.id, config: strip(draft) }, { onSuccess: () => toast.success('내 보기 설정으로 저장했습니다.') });
  const canSaveShared = view.personal || canEdit;
  const items = rows.data?.items ?? [];
  const viewProps = { properties, rows: items, canEdit, mutations, onOpenRow: openRow };

  return (
    <div className="min-w-0">
      <Link href="/admin/databases" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ChevronLeft className="size-4" />데이터베이스</Link>
      <header className="mb-5">
        {editingName && canEdit ? (
          <form onSubmit={(e) => {
            e.preventDefault();
            const name = String(new FormData(e.currentTarget).get('name') ?? '').trim();
            if (name && name !== d.name) mutations.updateDatabase.mutate({ name });
            setEditingName(false);
          }}>
            <Input name="name" defaultValue={d.name} autoFocus maxLength={200} onBlur={(e) => e.currentTarget.form?.requestSubmit()} className="h-10 text-2xl font-semibold" aria-label="데이터베이스 이름" />
          </form>
        ) : (
          <h1 className="text-2xl font-semibold tracking-tight">
            <button type="button" disabled={!canEdit} onClick={() => setEditingName(true)} className="rounded text-left hover:bg-muted/60 disabled:hover:bg-transparent">
              {d.icon && <span className="mr-2">{d.icon}</span>}{d.name}
            </button>
          </h1>
        )}
        {d.description && <p className="mt-1 text-sm text-muted-foreground">{d.description}</p>}
        <p className="mt-1 text-xs text-muted-foreground">{d.workspace?.name} · {d.rowCount.toLocaleString()}개 항목{!canEdit && ' · 읽기 전용'}</p>
      </header>

      <DevStatus status="PARTIAL">
        표·보드·캘린더·리스트·갤러리 보기, 타입별 셀 편집, 필터/정렬/그룹, 뷰 저장, CSV 가져오기/내보내기가 동작합니다.
        후속: 타임라인 보기 화면, 수식(FORMULA)·롤업(ROLLUP) 속성, 첨부 파일 이름 미리보기(파일 API 목록 연동), 열 너비 드래그 조절.
      </DevStatus>

      {/* 뷰 탭 */}
      <div className="mb-3 flex items-center gap-1 overflow-x-auto border-b border-border" role="group" aria-label="보기">
        {views.map((v) => (
          <div key={v.id} className={cn('group flex shrink-0 items-center border-b-2 -mb-px', v.id === view.id ? 'border-foreground' : 'border-transparent')}>
            <button type="button" aria-pressed={v.id === view.id} onClick={() => selectView(v.id)} className={cn('px-2.5 py-2 text-sm', v.id === view.id ? 'font-medium' : 'text-muted-foreground hover:text-foreground')}>
              {v.name}
              {(VIEW_TYPE_LABELS[v.type] !== v.name || v.personal) && (
                <span className="ml-1 text-xs text-muted-foreground">{VIEW_TYPE_LABELS[v.type] !== v.name ? VIEW_TYPE_LABELS[v.type] : ''}{v.personal ? `${VIEW_TYPE_LABELS[v.type] !== v.name ? ' · ' : ''}개인` : ''}</span>
              )}
            </button>
            {(v.personal || canEdit) && v.id === view.id && (
              <DropdownMenu>
                <DropdownMenuTrigger className="rounded p-1 text-muted-foreground hover:bg-muted" aria-label={`${v.name} 뷰 메뉴`}><MoreHorizontal className="size-3.5" /></DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onSelect={() => setViewDialog({ open: true, view: v })}>이름 변경</DropdownMenuItem>
                  <DropdownMenuItem className="text-danger" onSelect={() => {
                    if (!window.confirm(`"${v.name}" 뷰를 삭제할까요?`)) return;
                    mutations.deleteView.mutate(v.id, { onSuccess: () => selectView(views.find((x) => x.id !== v.id)?.id ?? '') });
                  }}>뷰 삭제</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        ))}
        <button type="button" onClick={() => setViewDialog({ open: true, view: null })} className="ml-1 flex shrink-0 items-center gap-1 rounded px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted"><Plus className="size-4" />뷰 추가</button>
      </div>

      {/* 도구 모음 */}
      <div className="mb-4 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-1">
          <ViewControls properties={properties} config={draft} onChange={(c) => { setDraft(c); setPage(1); }} showGroup={view.type === 'TABLE' || view.type === 'BOARD'} />
          {view.type === 'CALENDAR' && properties.filter((p) => p.type === 'DATE').length > 1 && (
            <select aria-label="날짜 속성" value={dateProp?.id ?? ''} onChange={(e) => setDraft({ ...draft, datePropertyId: e.target.value })} className="h-8 rounded-md border border-border bg-background px-2 text-sm">
              {properties.filter((p) => p.type === 'DATE').map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          {dirty && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button size="sm" variant="outline"><Save />보기 저장</Button></DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuLabel>현재 필터·정렬·표시 설정</DropdownMenuLabel>
                {canSaveShared && <DropdownMenuItem onSelect={saveShared}>{view.personal ? '개인 뷰에 저장' : '공유 뷰에 저장 (모두에게 적용)'}</DropdownMenuItem>}
                {!view.personal && <DropdownMenuItem onSelect={savePersonal}>내 보기 설정으로 저장</DropdownMenuItem>}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setDraft(baseline)}>변경 취소</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {!dirty && view.preference && !view.personal && (
            <Button size="sm" variant="ghost" onClick={() => mutations.clearPreference.mutate(view.id)}>내 설정 초기화</Button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="제목 검색" aria-label="제목 검색" className="h-8 w-44 pl-8" />
          </div>
          <Button size="sm" variant="outline" asChild>
            <a href={`/api/v1/databases/${id}/export.csv?viewId=${view.id}`} download><Download />CSV</a>
          </Button>
          {canEdit && <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}><Upload />가져오기</Button>}
          {canEdit && <Button size="sm" onClick={() => mutations.createRow.mutate({}, { onSuccess: (r) => openRow(r.id) })} loading={mutations.createRow.isPending}><Plus />새 항목</Button>}
        </div>
      </div>

      {view.type === 'TIMELINE' ? (
        <DevStatus status="NOT_STARTED">타임라인(간트) 보기 화면은 후속 구현입니다. 뷰 설정(날짜 속성)은 저장되며, 같은 데이터를 표·캘린더 보기에서 확인할 수 있습니다.</DevStatus>
      ) : rows.isLoading ? (
        <LoadingRows rows={6} />
      ) : rows.error ? (
        <ErrorState error={rows.error} />
      ) : (
        <>
          {view.type === 'TABLE' && (
            <TableView
              {...viewProps}
              properties={visible}
              onEditProperty={(p) => setPropDialog({ open: true, prop: p })}
              onAddProperty={() => setPropDialog({ open: true, prop: null })}
              groupBy={groupProp}
              reorderable={!(draft.sorts?.length) && !completeFilters.length && !q && (rows.data?.totalPages ?? 1) === 1}
              widths={draft.propertyWidths}
            />
          )}
          {view.type === 'BOARD' && <BoardView {...viewProps} groupProp={groupProp} cardProps={visible} />}
          {view.type === 'CALENDAR' && <CalendarView {...viewProps} dateProp={dateProp} />}
          {view.type === 'LIST' && <ListView {...viewProps} visible={visible} />}
          {view.type === 'GALLERY' && <GalleryView {...viewProps} visible={visible} />}
          {items.length === 0 && view.type !== 'TABLE' && view.type !== 'BOARD' && view.type !== 'CALENDAR' && (
            <EmptyState
              title={completeFilters.length || q ? '조건에 맞는 항목이 없습니다' : '아직 항목이 없습니다'}
              description={canEdit ? '새 항목을 추가하거나 CSV 를 가져오세요.' : undefined}
            />
          )}
          {!bulk && rows.data && <Pagination page={rows.data.page} totalPages={rows.data.totalPages} onChange={setPage} />}
          {bulk && rows.data && rows.data.total > rows.data.items.length && (
            <p className="mt-2 text-xs text-muted-foreground">이 보기에는 처음 {rows.data.items.length}개 항목만 표시됩니다 (전체 {rows.data.total}개). 필터로 범위를 좁히세요.</p>
          )}
        </>
      )}

      <PropertyDialog open={propDialog.open} onOpenChange={(o) => setPropDialog((s) => ({ ...s, open: o }))} databaseId={id} property={propDialog.prop} mutations={mutations} />
      <ViewDialog open={viewDialog.open} onOpenChange={(o) => setViewDialog((s) => ({ ...s, open: o }))} view={viewDialog.view} canEdit={canEdit} mutations={mutations} onCreated={selectView} />
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} mutations={mutations} />
      <RowDialog databaseId={id} rowId={openRowId} properties={properties} canEdit={canEdit} mutations={mutations} onClose={() => setUrl('row', null)} />
    </div>
  );
}
