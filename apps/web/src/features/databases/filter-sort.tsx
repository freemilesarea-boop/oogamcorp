'use client';
import * as Popover from '@radix-ui/react-popover';
import { ArrowUpDown, Eye, Filter as FilterIcon, Layers, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/misc';
import { useDirectory } from '@/lib/directory';
import { NO_VALUE_OPERATORS, OPERATORS, type DbProperty, type Filter, type Sort, type ViewConfig } from './types';

function Panel({ label, icon, count, children, wide }: { label: string; icon: React.ReactNode; count?: number; children: React.ReactNode; wide?: boolean }) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button variant={count ? 'secondary' : 'ghost'} size="sm">{icon}{label}{count ? <span className="tabular-nums">{count}</span> : null}</Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} className={`z-50 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-background p-3 shadow-lg ${wide ? 'w-[34rem]' : 'w-72'}`}>
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function FilterValue({ prop, filter, onChange }: { prop: DbProperty; filter: Filter; onChange: (v: unknown) => void }) {
  const { data: users = [] } = useDirectory();
  if (NO_VALUE_OPERATORS.includes(filter.operator)) return <span className="flex-1" />;
  const cls = 'h-8 flex-1 min-w-0';
  switch (prop.type) {
    case 'NUMBER':
      return <input type="number" aria-label="값" className={`${cls} rounded-md border border-border bg-background px-2 text-sm`} value={typeof filter.value === 'number' ? filter.value : ''} onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))} />;
    case 'DATE':
      return <input type="date" aria-label="값" className={`${cls} rounded-md border border-border bg-background px-2 text-sm`} value={(filter.value as string) ?? ''} onChange={(e) => onChange(e.target.value || undefined)} />;
    case 'SELECT':
    case 'MULTI_SELECT':
      return (
        <NativeSelect aria-label="값" className={cls} value={(filter.value as string) ?? ''} onChange={(e) => onChange(e.target.value || undefined)}>
          <option value="">옵션 선택</option>
          {(prop.config.options ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </NativeSelect>
      );
    case 'PERSON':
      return (
        <NativeSelect aria-label="값" className={cls} value={(filter.value as string) ?? ''} onChange={(e) => onChange(e.target.value || undefined)}>
          <option value="">사람 선택</option>
          <option value="me">나</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </NativeSelect>
      );
    default:
      return <input aria-label="값" className={`${cls} rounded-md border border-border bg-background px-2 text-sm`} value={(filter.value as string) ?? ''} maxLength={500} onChange={(e) => onChange(e.target.value || undefined)} />;
  }
}

/** 필터·정렬·그룹·표시 속성 편집 (초안 설정을 수정하고, 저장은 상위에서) */
export function ViewControls({ properties, config, onChange, showGroup }: {
  properties: DbProperty[];
  config: ViewConfig;
  onChange: (c: ViewConfig) => void;
  showGroup?: boolean;
}) {
  const filters = config.filters ?? [];
  const sorts = config.sorts ?? [];
  const filterable = properties.filter((p) => OPERATORS[p.type]);
  const setFilter = (i: number, f: Filter) => onChange({ ...config, filters: filters.map((x, j) => (j === i ? f : x)) });
  const groupable = properties.filter((p) => ['SELECT', 'PERSON', 'CHECKBOX'].includes(p.type));
  const visible = config.visibleProperties;
  const complete = filters.filter((f) => NO_VALUE_OPERATORS.includes(f.operator) || (f.value !== undefined && f.value !== '')).length;

  return (
    <div className="flex flex-wrap items-center gap-1">
      <Panel label="필터" icon={<FilterIcon />} count={complete} wide>
        <div className="space-y-2">
          {filters.length > 1 && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">조건 결합</span>
              <NativeSelect aria-label="조건 결합" className="h-7 w-28" value={config.filterMode ?? 'and'} onChange={(e) => onChange({ ...config, filterMode: e.target.value as 'and' | 'or' })}>
                <option value="and">모두 충족(AND)</option>
                <option value="or">하나라도(OR)</option>
              </NativeSelect>
            </div>
          )}
          {filters.map((f, i) => {
            const prop = properties.find((p) => p.id === f.propertyId);
            if (!prop) return null;
            return (
              <div key={i} className="flex flex-wrap items-center gap-1.5 sm:flex-nowrap">
                <NativeSelect aria-label="속성" className="h-8 w-32 shrink-0" value={f.propertyId} onChange={(e) => {
                  const np = properties.find((p) => p.id === e.target.value)!;
                  setFilter(i, { propertyId: np.id, operator: OPERATORS[np.type][0].value });
                }}>
                  {filterable.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </NativeSelect>
                <NativeSelect aria-label="연산자" className="h-8 w-32 shrink-0" value={f.operator} onChange={(e) => setFilter(i, { propertyId: f.propertyId, operator: e.target.value, ...(NO_VALUE_OPERATORS.includes(e.target.value) ? {} : { value: f.value }) })}>
                  {OPERATORS[prop.type].map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </NativeSelect>
                <FilterValue prop={prop} filter={f} onChange={(v) => setFilter(i, { ...f, value: v })} />
                <Button variant="ghost" size="icon-sm" aria-label="필터 삭제" onClick={() => onChange({ ...config, filters: filters.filter((_, j) => j !== i) })}><X /></Button>
              </div>
            );
          })}
          {filters.length === 0 && <p className="text-xs text-muted-foreground">필터가 없습니다.</p>}
          {filterable.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => onChange({ ...config, filters: [...filters, { propertyId: filterable[0].id, operator: OPERATORS[filterable[0].type][0].value }] })}>
              <Plus />필터 추가
            </Button>
          )}
        </div>
      </Panel>

      <Panel label="정렬" icon={<ArrowUpDown />} count={sorts.length}>
        <div className="space-y-2">
          {sorts.map((s, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <NativeSelect aria-label="정렬 속성" className="h-8 flex-1" value={s.propertyId} onChange={(e) => onChange({ ...config, sorts: sorts.map((x, j) => (j === i ? { ...x, propertyId: e.target.value } : x)) })}>
                {properties.filter((p) => p.type !== 'FILE').map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                <option value="createdAt">생성일</option>
                <option value="updatedAt">수정일</option>
              </NativeSelect>
              <NativeSelect aria-label="방향" className="h-8 w-24" value={s.direction} onChange={(e) => onChange({ ...config, sorts: sorts.map((x, j) => (j === i ? { ...x, direction: e.target.value as Sort['direction'] } : x)) })}>
                <option value="asc">오름차순</option>
                <option value="desc">내림차순</option>
              </NativeSelect>
              <Button variant="ghost" size="icon-sm" aria-label="정렬 삭제" onClick={() => onChange({ ...config, sorts: sorts.filter((_, j) => j !== i) })}><X /></Button>
            </div>
          ))}
          {sorts.length === 0 && <p className="text-xs text-muted-foreground">기본 순서(수동 정렬)로 표시합니다.</p>}
          {sorts.length < 10 && (
            <Button variant="outline" size="sm" onClick={() => onChange({ ...config, sorts: [...sorts, { propertyId: properties[0]?.id ?? 'createdAt', direction: 'asc' }] })}><Plus />정렬 추가</Button>
          )}
        </div>
      </Panel>

      {showGroup && (
        <Panel label="그룹" icon={<Layers />} count={config.groupBy ? 1 : 0}>
          <NativeSelect aria-label="그룹 기준" value={config.groupBy ?? ''} onChange={(e) => onChange({ ...config, groupBy: e.target.value || null })}>
            <option value="">그룹 없음</option>
            {groupable.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </NativeSelect>
          <p className="mt-2 text-xs text-muted-foreground">선택·사람·체크박스 속성으로 그룹화할 수 있습니다.</p>
        </Panel>
      )}

      <Panel label="속성" icon={<Eye />}>
        <ul className="space-y-1.5">
          {properties.map((p) => {
            const on = !visible || visible.includes(p.id);
            return (
              <li key={p.id} className="flex items-center gap-2 text-sm">
                <Checkbox
                  id={`vis-${p.id}`}
                  checked={on}
                  disabled={p.type === 'TITLE'}
                  onCheckedChange={(c) => {
                    const base = visible ?? properties.map((x) => x.id);
                    onChange({ ...config, visibleProperties: c ? [...base, p.id] : base.filter((x) => x !== p.id) });
                  }}
                />
                <label htmlFor={`vis-${p.id}`} className="flex-1 truncate">{p.name}</label>
              </li>
            );
          })}
        </ul>
      </Panel>
    </div>
  );
}
