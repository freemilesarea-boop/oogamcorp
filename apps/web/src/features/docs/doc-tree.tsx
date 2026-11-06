'use client';
import {
  DndContext, DragOverlay, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragMoveEvent, type DragStartEvent,
} from '@dnd-kit/core';
import {
  ArrowDown, ArrowUp, ChevronRight, Copy, CopyPlus, CornerLeftUp, FileText, LayoutTemplate, Lock, MoreHorizontal, Plus, Search, Trash2, Users,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/misc';
import { useCan } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { atLeast, useCreateDocument, useDocActions, useDocTree, useMoveDocument, type TreeNode } from './api';

const EXPANDED_KEY = 'oogam.docs.expanded';
type Zone = 'before' | 'inside' | 'after';

function loadExpanded(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

/** 트리 평탄화 (형제/상위 조회용) */
function index(nodes: TreeNode[]) {
  const byId = new Map<string, { node: TreeNode; parent: TreeNode | null; siblings: TreeNode[] }>();
  const walk = (list: TreeNode[], parent: TreeNode | null) => {
    for (const n of list) {
      byId.set(n.id, { node: n, parent, siblings: list });
      walk(n.children, n);
    }
  };
  walk(nodes, null);
  return byId;
}

function isDescendant(byId: ReturnType<typeof index>, ancestorId: string, id: string): boolean {
  let cur = byId.get(id)?.parent ?? null;
  while (cur) {
    if (cur.id === ancestorId) return true;
    cur = byId.get(cur.id)?.parent ?? null;
  }
  return false;
}

export function DocTree({ onNavigate }: { onNavigate?: () => void }) {
  const tree = useDocTree();
  const can = useCan();
  const router = useRouter();
  const pathname = usePathname();
  const create = useCreateDocument();
  const move = useMoveDocument();
  const actions = useDocActions();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [drag, setDrag] = useState<{ activeId: string; overId: string | null; zone: Zone | null } | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const items = useMemo(() => tree.data?.items ?? [], [tree.data]);
  const byId = useMemo(() => index(items), [items]);
  const activeId = pathname.startsWith('/admin/docs/') ? pathname.split('/')[3] : null;

  useEffect(() => setExpanded(loadExpanded()), []);
  const persist = (s: Set<string>) => {
    try {
      localStorage.setItem(EXPANDED_KEY, JSON.stringify([...s]));
    } catch {
      /* 저장소 사용 불가 시 무시 */
    }
  };
  const toggle = useCallback((id: string, open?: boolean) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (open ?? !next.has(id)) next.add(id);
      else next.delete(id);
      persist(next);
      return next;
    });
  }, []);

  // 현재 문서의 상위 경로 자동 펼침
  useEffect(() => {
    if (!activeId) return;
    let cur = byId.get(activeId)?.parent;
    const ids: string[] = [];
    while (cur) {
      ids.push(cur.id);
      cur = byId.get(cur.id)?.parent ?? null;
    }
    if (ids.length) setExpanded((prev) => (ids.every((i) => prev.has(i)) ? prev : new Set([...prev, ...ids])));
  }, [activeId, byId]);

  const createPage = (parentId?: string) => {
    create.mutate(
      { parentId, title: '' },
      {
        onSuccess: (doc) => {
          if (parentId) toggle(parentId, true);
          onNavigate?.();
          router.push(`/admin/docs/${doc.id}`);
        },
        onError: (e) => toast.error((e as Error).message),
      },
    );
  };

  const doMove = (id: string, body: { parentId?: string | null; beforeId?: string; afterId?: string }) =>
    move.mutate({ id, ...body }, { onError: (e) => toast.error((e as Error).message) });

  const zoneOf = (e: DragMoveEvent | DragEndEvent): Zone | null => {
    if (!e.over) return null;
    const start = (e.activatorEvent as PointerEvent | undefined)?.clientY;
    if (start === undefined) return 'inside';
    const y = start + e.delta.y;
    const { top, height } = e.over.rect;
    if (y < top + height * 0.28) return 'before';
    if (y > top + height * 0.72) return 'after';
    return 'inside';
  };
  const validDrop = (activeIdent: string, overId: string, zone: Zone) => {
    if (activeIdent === overId) return false;
    if (isDescendant(byId, activeIdent, overId)) return false;
    const over = byId.get(overId);
    if (!over) return false;
    if (zone === 'inside') return atLeast(over.node.access, 'EDIT');
    return !over.parent || atLeast(over.parent.access, 'EDIT');
  };
  const onDragStart = (e: DragStartEvent) => setDrag({ activeId: String(e.active.id), overId: null, zone: null });
  const onDragMove = (e: DragMoveEvent) => {
    const zone = zoneOf(e);
    const overId = e.over ? String(e.over.id) : null;
    setDrag((d) => (d && (d.overId !== overId || d.zone !== zone) ? { ...d, overId, zone } : d));
  };
  const onDragEnd = (e: DragEndEvent) => {
    setDrag(null);
    const zone = zoneOf(e);
    if (!e.over || !zone) return;
    const id = String(e.active.id);
    const overId = String(e.over.id);
    if (!validDrop(id, overId, zone)) return;
    const over = byId.get(overId)!;
    if (zone === 'inside') {
      toggle(overId, true);
      doMove(id, { parentId: overId });
    } else {
      doMove(id, { parentId: over.parent?.id ?? null, [zone === 'before' ? 'beforeId' : 'afterId']: overId });
    }
  };

  const canWrite = can('docs.write');
  const dragged = drag ? byId.get(drag.activeId)?.node : null;

  return (
    <nav aria-label="문서 트리" className="flex h-full flex-col">
      <div className="space-y-0.5 px-2 pb-2">
        <SideLink href="/admin/docs" icon={Search} label="검색 · 홈" active={pathname === '/admin/docs'} onClick={onNavigate} />
        <SideLink href="/admin/docs?view=templates" icon={LayoutTemplate} label="템플릿" onClick={onNavigate} />
        <SideLink href="/admin/docs?view=trash" icon={Trash2} label="휴지통" onClick={onNavigate} />
      </div>
      <div className="flex items-center justify-between px-3 pb-1 pt-2">
        <span className="text-xs font-medium text-muted-foreground">{tree.data?.workspace.name ?? '워크스페이스'}</span>
        {canWrite && (
          <button type="button" onClick={() => createPage()} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="새 문서" title="새 문서">
            <Plus className="size-3.5" />
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-4">
        {tree.isLoading && <div className="space-y-1.5 px-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-6" />)}</div>}
        {tree.isError && <p className="px-3 py-2 text-xs text-red-600">문서 목록을 불러오지 못했습니다.</p>}
        {tree.data && items.length === 0 && (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">
            아직 문서가 없습니다.
            {canWrite && <button type="button" className="mt-2 block w-full underline underline-offset-2" onClick={() => createPage()}>첫 문서 만들기</button>}
          </div>
        )}
        <DndContext sensors={sensors} onDragStart={onDragStart} onDragMove={onDragMove} onDragEnd={onDragEnd} onDragCancel={() => setDrag(null)}>
          <ul role="tree" aria-label="문서">
            {items.map((n) => (
              <TreeItem
                key={n.id}
                node={n}
                depth={0}
                expanded={expanded}
                activeId={activeId}
                drag={drag && validDrop(drag.activeId, drag.overId ?? '', drag.zone ?? 'inside') ? drag : null}
                canWrite={canWrite}
                onToggle={toggle}
                onCreateChild={createPage}
                onNavigate={onNavigate}
                onMove={(id, dir) => {
                  const info = byId.get(id);
                  if (!info) return;
                  const i = info.siblings.findIndex((s) => s.id === id);
                  if (dir === 'root') return doMove(id, { parentId: null });
                  const target = info.siblings[dir === 'up' ? i - 1 : i + 1];
                  if (!target) return;
                  doMove(id, { parentId: info.parent?.id ?? null, [dir === 'up' ? 'beforeId' : 'afterId']: target.id });
                }}
                onDuplicate={(id, includeChildren) =>
                  actions.duplicate.mutate({ id, includeChildren }, {
                    onSuccess: (r) => { toast.success(`${r.count}개 문서를 복제했습니다.`); router.push(`/admin/docs/${r.id}`); },
                    onError: (e) => toast.error((e as Error).message),
                  })
                }
                onDelete={(id) =>
                  actions.remove.mutate(id, {
                    onSuccess: (r) => {
                      toast.success(`휴지통으로 이동했습니다${r.count > 1 ? ` (하위 문서 ${r.count - 1}개 포함)` : ''}.`);
                      if (activeId && (activeId === id || isDescendant(byId, id, activeId))) router.push('/admin/docs');
                    },
                    onError: (e) => toast.error((e as Error).message),
                  })
                }
              />
            ))}
          </ul>
          <DragOverlay dropAnimation={null}>
            {dragged && (
              <div className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-sm shadow-lg">
                <span>{dragged.icon ?? <FileText className="size-3.5" />}</span>
                <span className="truncate">{dragged.title || '제목 없음'}</span>
              </div>
            )}
          </DragOverlay>
        </DndContext>
      </div>
    </nav>
  );
}

function SideLink({ href, icon: Icon, label, active, onClick }: { href: string; icon: typeof Search; label: string; active?: boolean; onClick?: () => void }) {
  return (
    <Link href={href} onClick={onClick} className={cn('flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground', active && 'bg-muted text-foreground')}>
      <Icon className="size-4" />
      {label}
    </Link>
  );
}

interface ItemProps {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  activeId: string | null;
  drag: { activeId: string; overId: string | null; zone: Zone | null } | null;
  canWrite: boolean;
  onToggle: (id: string, open?: boolean) => void;
  onCreateChild: (parentId: string) => void;
  onNavigate?: () => void;
  onMove: (id: string, dir: 'up' | 'down' | 'root') => void;
  onDuplicate: (id: string, includeChildren: boolean) => void;
  onDelete: (id: string) => void;
}

function TreeItem(props: ItemProps) {
  const { node, depth, expanded, activeId, drag, canWrite, onToggle, onCreateChild, onNavigate, onMove, onDuplicate, onDelete } = props;
  const open = expanded.has(node.id);
  const editable = canWrite && atLeast(node.access, 'EDIT');
  const draggable = useDraggable({ id: node.id, disabled: !editable });
  const droppable = useDroppable({ id: node.id });
  const setRef = (el: HTMLDivElement | null) => {
    draggable.setNodeRef(el);
    droppable.setNodeRef(el);
  };
  const zone = drag?.overId === node.id ? drag.zone : null;
  const hasChildren = node.children.length > 0;

  return (
    <li role="treeitem" aria-expanded={hasChildren ? open : undefined} aria-selected={activeId === node.id}>
      <div
        ref={setRef}
        {...draggable.listeners}
        className={cn(
          'group relative flex h-8 items-center gap-0.5 rounded-md pr-1 text-sm hover:bg-muted',
          activeId === node.id && 'bg-muted font-medium',
          draggable.isDragging && 'opacity-40',
          zone === 'inside' && 'bg-gray-200 ring-1 ring-foreground/30 dark:bg-gray-800',
        )}
        style={{ paddingLeft: depth * 14 + 4 }}
      >
        {zone === 'before' && <span className="pointer-events-none absolute inset-x-1 top-0 h-0.5 rounded bg-foreground" />}
        {zone === 'after' && <span className="pointer-events-none absolute inset-x-1 bottom-0 h-0.5 rounded bg-foreground" />}
        <button
          type="button"
          onClick={() => onToggle(node.id)}
          className={cn('flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-gray-200 dark:hover:bg-gray-800', !hasChildren && 'opacity-30')}
          aria-label={open ? '접기' : '펼치기'}
        >
          <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
        </button>
        <Link href={`/admin/docs/${node.id}`} onClick={onNavigate} className="flex min-w-0 flex-1 items-center gap-1.5 truncate py-1 outline-none focus-visible:underline">
          <span className="w-4 shrink-0 text-center text-[13px]">{node.icon ?? <FileText className="inline size-3.5 text-muted-foreground" />}</span>
          <span className={cn('truncate', !node.title && 'text-muted-foreground')}>{node.title || '제목 없음'}</span>
          {node.visibility === 'PRIVATE' && <Lock className="size-3 shrink-0 text-muted-foreground" aria-label="비공개" />}
          {node.visibility === 'RESTRICTED' && <Users className="size-3 shrink-0 text-muted-foreground" aria-label="제한됨" />}
        </Link>
        <div className="flex shrink-0 items-center opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
          <DropdownMenu>
            <DropdownMenuTrigger className="rounded p-1 text-muted-foreground hover:bg-gray-200 hover:text-foreground dark:hover:bg-gray-800" aria-label={`${node.title || '제목 없음'} 메뉴`}>
              <MoreHorizontal className="size-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {editable && <DropdownMenuItem onSelect={() => onCreateChild(node.id)}><Plus /> 하위 문서 추가</DropdownMenuItem>}
              {canWrite && <DropdownMenuItem onSelect={() => onDuplicate(node.id, false)}><Copy /> 복제</DropdownMenuItem>}
              {canWrite && hasChildren && <DropdownMenuItem onSelect={() => onDuplicate(node.id, true)}><CopyPlus /> 하위 문서 포함 복제</DropdownMenuItem>}
              {editable && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => onMove(node.id, 'up')}><ArrowUp /> 위로 이동</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => onMove(node.id, 'down')}><ArrowDown /> 아래로 이동</DropdownMenuItem>
                  {node.parentId && <DropdownMenuItem onSelect={() => onMove(node.id, 'root')}><CornerLeftUp /> 최상위로 이동</DropdownMenuItem>}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="text-red-600" onSelect={() => onDelete(node.id)}><Trash2 /> 휴지통으로 이동</DropdownMenuItem>
                </>
              )}
              {!editable && !canWrite && <DropdownMenuItem disabled>보기 권한만 있습니다</DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>
          {editable && (
            <button type="button" onClick={() => onCreateChild(node.id)} className="rounded p-1 text-muted-foreground hover:bg-gray-200 hover:text-foreground dark:hover:bg-gray-800" aria-label="하위 문서 추가">
              <Plus className="size-3.5" />
            </button>
          )}
        </div>
      </div>
      {open && hasChildren && (
        <ul role="group">
          {node.children.map((c) => <TreeItem key={c.id} {...props} node={c} depth={depth + 1} />)}
        </ul>
      )}
    </li>
  );
}
