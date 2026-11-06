'use client';
import { DB_PROPERTY_TYPES, DB_PROPERTY_TYPE_LABELS } from '@oogam/shared';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, NativeSelect } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { useDatabases, type DbMutations } from './api';
import { NUMBER_FORMAT_LABELS, OPTION_COLOR_LABELS, type DbProperty, type PropertyConfig, type PropType, type SelectOption } from './types';

const newOptionId = () => Math.random().toString(36).slice(2, 10);

/** 속성 추가/수정 (이름·타입·타입별 설정). 타입 변경 시 서버에서 셀을 변환하거나 비운다 */
export function PropertyDialog({ open, onOpenChange, databaseId, property, mutations }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  databaseId: string;
  property: DbProperty | null;
  mutations: DbMutations;
}) {
  const [name, setName] = useState('');
  const [type, setType] = useState<PropType>('TEXT');
  const [options, setOptions] = useState<SelectOption[]>([]);
  const [format, setFormat] = useState<NonNullable<PropertyConfig['format']>>('number');
  const [target, setTarget] = useState('');
  const dbs = useDatabases({ pageSize: 100 });

  useEffect(() => {
    if (!open) return;
    setName(property?.name ?? '');
    setType(property?.type ?? 'TEXT');
    setOptions(property?.config.options ?? []);
    setFormat(property?.config.format ?? 'number');
    setTarget(property?.config.targetDatabaseId ?? '');
  }, [open, property]);

  const isTitle = property?.type === 'TITLE';
  const typeChanged = !!property && property.type !== type;
  const buildConfig = (): PropertyConfig | undefined => {
    if (type === 'SELECT' || type === 'MULTI_SELECT') return { options: options.filter((o) => o.name.trim()).map((o) => ({ ...o, name: o.name.trim() })) };
    if (type === 'NUMBER') return { format };
    if (type === 'RELATION') return { targetDatabaseId: target };
    if (type === 'DATE') return {};
    return property && !typeChanged ? undefined : {};
  };

  const pending = mutations.createProperty.isPending || mutations.updateProperty.isPending || mutations.deleteProperty.isPending;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const config = isTitle ? undefined : buildConfig();
    if (property) {
      if (typeChanged && !window.confirm('타입을 바꾸면 변환할 수 없는 값은 지워집니다. 계속할까요?')) return;
      await mutations.updateProperty.mutateAsync({ pid: property.id, name: name.trim(), ...(typeChanged ? { type } : {}), ...(config ? { config } : {}) });
    } else {
      await mutations.createProperty.mutateAsync({ name: name.trim(), type, ...(config ? { config } : {}) });
    }
    onOpenChange(false);
  };

  const remove = async () => {
    if (!property || !window.confirm(`"${property.name}" 속성과 모든 값을 삭제할까요?`)) return;
    await mutations.deleteProperty.mutateAsync(property.id);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{property ? '속성 편집' : '속성 추가'}</DialogTitle>
            <DialogDescription>값은 서버에서 속성 타입에 맞게 검증됩니다.</DialogDescription>
          </DialogHeader>
          <Field label="이름" htmlFor="prop-name">
            <Input id="prop-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required autoFocus />
          </Field>
          <Field label="타입" htmlFor="prop-type" hint={isTitle ? '제목 속성의 타입은 변경할 수 없습니다.' : typeChanged ? '타입 변경 시 기존 값은 변환되며, 변환할 수 없는 값은 지워집니다.' : undefined}>
            <NativeSelect id="prop-type" value={type} disabled={isTitle} onChange={(e) => setType(e.target.value as PropType)}>
              {isTitle && <option value="TITLE">제목</option>}
              {DB_PROPERTY_TYPES.filter((t) => t !== 'TITLE').map((t) => <option key={t} value={t}>{DB_PROPERTY_TYPE_LABELS[t]}</option>)}
              <option value="FORMULA" disabled>수식 (후속 구현)</option>
              <option value="ROLLUP" disabled>롤업 (후속 구현)</option>
            </NativeSelect>
          </Field>

          {(type === 'SELECT' || type === 'MULTI_SELECT') && (
            <div className="space-y-2">
              <p className="text-[13px] font-medium">옵션</p>
              <ul className="space-y-1.5">
                {options.map((o, i) => (
                  <li key={o.id} className="flex items-center gap-2">
                    <Input aria-label={`옵션 ${i + 1} 이름`} value={o.name} maxLength={100} onChange={(e) => setOptions(options.map((x) => (x.id === o.id ? { ...x, name: e.target.value } : x)))} className="h-8" />
                    <NativeSelect aria-label={`옵션 ${i + 1} 색상`} value={o.color} onChange={(e) => setOptions(options.map((x) => (x.id === o.id ? { ...x, color: e.target.value } : x)))} className="h-8 w-24">
                      {Object.entries(OPTION_COLOR_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </NativeSelect>
                    <Button type="button" variant="ghost" size="icon-sm" aria-label="옵션 삭제" onClick={() => setOptions(options.filter((x) => x.id !== o.id))}><Trash2 /></Button>
                  </li>
                ))}
              </ul>
              <Button type="button" variant="outline" size="sm" onClick={() => setOptions([...options, { id: newOptionId(), name: '', color: 'gray' }])}><Plus />옵션 추가</Button>
              {property && <p className="text-xs text-muted-foreground">삭제한 옵션을 사용하던 값은 비워집니다.</p>}
            </div>
          )}
          {type === 'NUMBER' && (
            <Field label="숫자 형식" htmlFor="prop-format">
              <NativeSelect id="prop-format" value={format} onChange={(e) => setFormat(e.target.value as typeof format)}>
                {Object.entries(NUMBER_FORMAT_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </NativeSelect>
            </Field>
          )}
          {type === 'RELATION' && (
            <Field label="연결할 데이터베이스" htmlFor="prop-target" hint="같은 조직의 접근 가능한 데이터베이스만 연결할 수 있습니다. 대상을 바꾸면 기존 값은 지워집니다.">
              <NativeSelect id="prop-target" value={target} onChange={(e) => setTarget(e.target.value)} required>
                <option value="">선택…</option>
                {(dbs.data?.items ?? []).map((d) => <option key={d.id} value={d.id}>{d.icon ? `${d.icon} ` : ''}{d.name}{d.id === databaseId ? ' (현재)' : ''}</option>)}
              </NativeSelect>
            </Field>
          )}

          <DialogFooter className="sm:justify-between">
            {property && !isTitle ? (
              <Button type="button" variant="ghost" className="text-danger" onClick={remove} disabled={pending}><Trash2 />속성 삭제</Button>
            ) : <span />}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>취소</Button>
              <Button type="submit" loading={pending}>{property ? '저장' : '추가'}</Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
