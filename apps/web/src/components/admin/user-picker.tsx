'use client';
import * as Popover from '@radix-ui/react-popover';
import { Check, ChevronsUpDown, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useDirectory } from '@/lib/directory';
import { cn } from '@/lib/utils';
import { Avatar } from '@/components/ui/misc';

/** 사용자 선택 (단일/다중). value 는 userId 배열 */
export function UserPicker({
  value, onChange, multiple = true, placeholder = '사용자 선택', className, exclude = [],
}: {
  value: string[];
  onChange: (ids: string[]) => void;
  multiple?: boolean;
  placeholder?: string;
  className?: string;
  exclude?: string[];
}) {
  const { data: users = [] } = useDirectory();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const selected = users.filter((u) => value.includes(u.id));
  const filtered = useMemo(
    () => users.filter((u) => !exclude.includes(u.id) && (!q || u.name.includes(q) || u.email.toLowerCase().includes(q.toLowerCase()))),
    [users, q, exclude],
  );
  const toggle = (id: string) => {
    if (!multiple) {
      onChange(value[0] === id ? [] : [id]);
      setOpen(false);
      return;
    }
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  };
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        className={cn('flex min-h-9 w-full items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-left text-sm', className)}
        aria-label={placeholder}
      >
        <div className="flex flex-1 flex-wrap gap-1">
          {selected.length === 0 && <span className="text-muted-foreground">{placeholder}</span>}
          {selected.map((u) => (
            <span key={u.id} className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs">
              {u.name}
              {multiple && (
                <span role="button" tabIndex={-1} aria-label={`${u.name} 제거`} onClick={(e) => { e.stopPropagation(); toggle(u.id); }}>
                  <X className="size-3" />
                </span>
              )}
            </span>
          ))}
        </div>
        <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={4} className="z-[60] w-[var(--radix-popover-trigger-width)] min-w-64 rounded-lg border border-border bg-background p-1 shadow-lg">
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름 또는 이메일 검색" className="mb-1 h-8 w-full rounded-md border border-border bg-transparent px-2 text-sm outline-none" />
          <ul className="max-h-64 overflow-y-auto" role="listbox" aria-multiselectable={multiple}>
            {filtered.map((u) => (
              <li key={u.id}>
                <button type="button" role="option" aria-selected={value.includes(u.id)} onClick={() => toggle(u.id)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted">
                  <Avatar name={u.name} src={u.avatarUrl} className="size-6" />
                  <span className="flex-1 truncate">{u.name} <span className="text-xs text-muted-foreground">{u.department?.name ?? ''}{u.title ? ` · ${u.title}` : ''}</span></span>
                  {value.includes(u.id) && <Check className="size-4" />}
                </button>
              </li>
            ))}
            {filtered.length === 0 && <li className="px-2 py-4 text-center text-xs text-muted-foreground">결과 없음</li>}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
