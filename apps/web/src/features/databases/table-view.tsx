'use client';
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Maximize2, Plus, Trash2 } from 'lucide-react';
import { Fragment, useMemo } from 'react';
import { useDirectory } from '@/lib/directory';
import { cn } from '@/lib/utils';
import type { DbMutations } from './api';
import { CellEditor, OptionChip } from './cells';
import { PropIcon } from './prop-icon';
import type { DbProperty, DbRow } from './types';

export interface ViewProps {
  properties: DbProperty[];
  rows: DbRow[];
  canEdit: boolean;
  mutations: DbMutations;
  onOpenRow: (id: string) => void;
}

/** 그룹 키 계산 (SELECT/PERSON/CHECKBOX) — PERSON 은 첫 번째 사람 기준 */
export function groupKey(prop: DbProperty, row: DbRow): string {
  const v = row.cells[prop.id];
  if (prop.type === 'CHECKBOX') return v === true ? 'true' : 'false';
  if (prop.type === 'PERSON') return Array.isArray(v) && v.length ? String(v[0]) : '';
  return typeof v === 'string' ? v : '';
}

function GroupLabel({ prop, k }: { prop: DbProperty; k: string }) {
  const { data: users = [] } = useDirectory();
  if (!k) return <span className="text-muted-foreground">{prop.name} 없음</span>;
  if (prop.type === 'SELECT') return <OptionChip option={prop.config.options?.find((o) => o.id === k)} />;
  if (prop.type === 'CHECKBOX') return <span>{k === 'true' ? '체크됨' : '체크 안 됨'}</span>;
  return <span>{users.find((u) => u.id === k)?.name ?? '알 수 없음'}</span>;
}

function SortableRow({ row, children, enabled }: { row: DbRow; children: (handle: React.ReactNode) => React.ReactNode; enabled: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: row.id, disabled: !enabled });
  return (
    <tr ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn('group border-b border-border hover:bg-muted/30', isDragging && 'relative z-10 bg-background shadow-md')}>
      {children(
        enabled ? (
          <button type="button" className="cursor-grab rounded p-0.5 text-muted-foreground opacity-0 group-hover:opacity-100 focus:opacity-100" aria-label="행 순서 이동" {...attributes} {...listeners}>
            <GripVertical className="size-3.5" />
          </button>
        ) : null,
      )}
    </tr>
  );
}

/** 표 보기: 타입별 인라인 편집, 속성 헤더 편집, 드래그 순서 변경(정렬 미적용 + 단일 페이지일 때) */
export function TableView({ properties, rows, canEdit, mutations, onOpenRow, onEditProperty, onAddProperty, groupBy, reorderable, widths }: ViewProps & {
  onEditProperty: (p: DbProperty) => void;
  onAddProperty: () => void;
  groupBy?: DbProperty;
  reorderable: boolean;
  widths?: Record<string, number>;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const canDrag = canEdit && reorderable && !groupBy;
  const groups = useMemo(() => {
    if (!groupBy) return [{ key: '__all', rows }];
    const map = new Map<string, DbRow[]>();
    if (groupBy.type === 'SELECT') (groupBy.config.options ?? []).forEach((o) => map.set(o.id, []));
    for (const r of rows) {
      const k = groupKey(groupBy, r);
      map.set(k, [...(map.get(k) ?? []), r]);
    }
    return [...map.entries()].filter(([, rs]) => rs.length > 0).map(([key, rs]) => ({ key, rows: rs }));
  }, [rows, groupBy]);

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = rows.findIndex((r) => r.id === e.active.id);
    const to = rows.findIndex((r) => r.id === e.over!.id);
    mutations.reorderRows.mutate(arrayMove(rows, from, to).map((r) => r.id));
  };
  const save = (rowId: string, pid: string, v: unknown) => mutations.updateCells.mutate({ rowId, cells: { [pid]: v } });
  const colSpan = properties.length + 2;

  return (
    <div className="w-full overflow-x-auto rounded-lg border border-border">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <table className="w-full min-w-max border-collapse text-sm">
          <thead className="bg-muted/50 text-left">
            <tr className="border-b border-border">
              <th className="w-14"><span className="sr-only">행 도구</span></th>
              {properties.map((p) => (
                <th key={p.id} scope="col" style={{ width: widths?.[p.id] ?? (p.type === 'TITLE' ? 260 : 180) }} className="h-9 border-l border-border px-2 text-xs font-medium text-muted-foreground first-of-type:border-l-0">
                  <button type="button" disabled={!canEdit} onClick={() => onEditProperty(p)} className="flex w-full items-center gap-1.5 truncate rounded px-1 py-1 text-left hover:bg-muted disabled:hover:bg-transparent" aria-label={`${p.name} 속성 편집`}>
                    <PropIcon type={p.type} />
                    <span className="truncate">{p.name}</span>
                  </button>
                </th>
              ))}
              <th className="w-10 border-l border-border">
                {canEdit && <button type="button" onClick={onAddProperty} className="flex size-8 items-center justify-center rounded hover:bg-muted" aria-label="속성 추가"><Plus className="size-4" /></button>}
              </th>
            </tr>
          </thead>
          <SortableContext items={rows.map((r) => r.id)} strategy={verticalListSortingStrategy}>
            <tbody>
              {groups.map((g) => (
                <Fragment key={g.key}>
                  {groupBy && (
                    <tr className="border-b border-border bg-muted/20">
                      <td colSpan={colSpan} className="px-3 py-1.5 text-xs font-medium">
                        <span className="inline-flex items-center gap-2"><GroupLabel prop={groupBy} k={g.key} /><span className="text-muted-foreground tabular-nums">{g.rows.length}</span></span>
                      </td>
                    </tr>
                  )}
                  {g.rows.map((row) => (
                    <SortableRow key={row.id} row={row} enabled={canDrag}>
                      {(handle) => (
                        <>
                          <td className="px-1 align-middle">
                            <div className="flex items-center">
                              {handle}
                              <button type="button" onClick={() => onOpenRow(row.id)} className="rounded p-0.5 text-muted-foreground opacity-0 group-hover:opacity-100 focus:opacity-100" aria-label="행 열기"><Maximize2 className="size-3.5" /></button>
                            </div>
                          </td>
                          {properties.map((p) => (
                            <td key={p.id} className="max-w-0 border-l border-border px-1 py-0.5 align-middle first-of-type:border-l-0">
                              <CellEditor prop={p} value={row.cells[p.id]} rowId={row.id} editable={canEdit} onChange={(v) => save(row.id, p.id, v)} />
                            </td>
                          ))}
                          <td className="border-l border-border px-1 text-center">
                            {canEdit && (
                              <button type="button" onClick={() => window.confirm('이 행을 삭제할까요?') && mutations.deleteRow.mutate(row.id)} className="rounded p-1 text-muted-foreground opacity-0 hover:text-danger group-hover:opacity-100 focus:opacity-100" aria-label="행 삭제">
                                <Trash2 className="size-3.5" />
                              </button>
                            )}
                          </td>
                        </>
                      )}
                    </SortableRow>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </SortableContext>
        </table>
      </DndContext>
      {canEdit && (
        <button type="button" onClick={() => mutations.createRow.mutate({})} disabled={mutations.createRow.isPending} className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-sm text-muted-foreground hover:bg-muted/40">
          <Plus className="size-4" />새 행
        </button>
      )}
    </div>
  );
}
