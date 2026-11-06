'use client';
import { DndContext, KeyboardSensor, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { Plus } from 'lucide-react';
import { useMemo } from 'react';
import { EmptyState } from '@/components/admin/states';
import { cn } from '@/lib/utils';
import { CellDisplay, OptionChip } from './cells';
import type { ViewProps } from './table-view';
import type { DbProperty, DbRow } from './types';

function Card({ row, title, props, onOpen, draggable }: { row: DbRow; title?: DbProperty; props: DbProperty[]; onOpen: () => void; draggable: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: row.id, disabled: !draggable });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={cn('rounded-md border border-border bg-background p-2.5 text-sm shadow-xs transition-shadow hover:shadow-sm', isDragging && 'z-20 opacity-80 shadow-lg', draggable && 'cursor-grab')}
      {...attributes}
      {...listeners}
    >
      <button type="button" onClick={onOpen} onPointerDown={(e) => e.stopPropagation()} className="block w-full truncate text-left font-medium hover:underline">
        {(title && String(row.cells[title.id] ?? '')) || <span className="text-muted-foreground">제목 없음</span>}
      </button>
      <div className="mt-1.5 space-y-1 text-xs empty:hidden">
        {props.map((p) => {
          const v = row.cells[p.id];
          if (v === undefined || v === null) return null;
          return <div key={p.id} className="flex min-w-0 items-center gap-1"><CellDisplay prop={p} value={v} /></div>;
        })}
      </div>
    </div>
  );
}

function Column({ id, label, count, children, onAdd }: { id: string; label: React.ReactNode; count: number; children: React.ReactNode; onAdd?: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <section ref={setNodeRef} aria-label={typeof label === 'string' ? label : undefined} className={cn('flex w-72 shrink-0 flex-col rounded-lg bg-muted/40 p-2 transition-colors', isOver && 'bg-muted ring-2 ring-foreground/10')}>
      <header className="mb-2 flex items-center gap-2 px-1 text-xs font-medium">
        {label}
        <span className="tabular-nums text-muted-foreground">{count}</span>
      </header>
      <div className="flex min-h-16 flex-col gap-2">{children}</div>
      {onAdd && (
        <button type="button" onClick={onAdd} className="mt-2 flex items-center gap-1 rounded px-1 py-1 text-xs text-muted-foreground hover:bg-muted"><Plus className="size-3.5" />새 항목</button>
      )}
    </section>
  );
}

/** 보드 보기: 선택(SELECT) 속성 기준 열, 카드를 다른 열로 끌어 값 변경 */
export function BoardView({ properties, rows, canEdit, mutations, onOpenRow, groupProp, cardProps }: ViewProps & { groupProp?: DbProperty; cardProps: DbProperty[] }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor));
  const title = properties.find((p) => p.type === 'TITLE');
  const columns = useMemo(() => {
    if (!groupProp) return [];
    const cols = (groupProp.config.options ?? []).map((o) => ({ key: o.id, option: o, rows: [] as DbRow[] }));
    const none = { key: '__none', option: undefined, rows: [] as DbRow[] };
    for (const r of rows) {
      const v = r.cells[groupProp.id];
      (cols.find((c) => c.key === v) ?? none).rows.push(r);
    }
    return [none, ...cols];
  }, [rows, groupProp]);

  if (!groupProp) {
    return <EmptyState title="보드에 사용할 선택 속성이 없습니다" description="'선택' 타입 속성을 추가하거나 보기 설정의 그룹 기준을 선택하세요." />;
  }

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over) return;
    const row = rows.find((r) => r.id === e.active.id);
    const target = String(e.over.id);
    const next = target === '__none' ? null : target;
    if (!row || (row.cells[groupProp.id] ?? null) === next) return;
    mutations.updateCells.mutate({ rowId: row.id, cells: { [groupProp.id]: next } });
  };

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="flex gap-3 overflow-x-auto pb-4">
        {columns.map((c) => (
          <Column
            key={c.key}
            id={c.key}
            count={c.rows.length}
            label={c.option ? <OptionChip option={c.option} /> : <span className="text-muted-foreground">{groupProp.name} 없음</span>}
            onAdd={canEdit ? () => mutations.createRow.mutate(c.option ? { [groupProp.id]: c.option.id } : {}) : undefined}
          >
            {c.rows.map((r) => (
              <Card key={r.id} row={r} title={title} props={cardProps.filter((p) => p.id !== groupProp.id && p.type !== 'TITLE')} onOpen={() => onOpenRow(r.id)} draggable={canEdit} />
            ))}
          </Column>
        ))}
      </div>
    </DndContext>
  );
}
