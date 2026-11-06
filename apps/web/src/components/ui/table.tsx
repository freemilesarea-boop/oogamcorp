import * as React from 'react';
import { cn } from '@/lib/utils';

export function Table({ className, ...props }: React.HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-x-auto rounded-lg border border-border">
      <table className={cn('w-full caption-bottom text-sm', className)} {...props} />
    </div>
  );
}
export const THead = (p: React.HTMLAttributes<HTMLTableSectionElement>) => <thead {...p} className={cn('bg-muted/60 text-left', p.className)} />;
export const TBody = (p: React.HTMLAttributes<HTMLTableSectionElement>) => <tbody {...p} className={cn('[&_tr:last-child]:border-0', p.className)} />;
export const TR = (p: React.HTMLAttributes<HTMLTableRowElement>) => <tr {...p} className={cn('border-b border-border transition-colors hover:bg-muted/40', p.className)} />;
export const TH = (p: React.ThHTMLAttributes<HTMLTableCellElement>) => <th {...p} className={cn('h-9 px-3 text-xs font-medium whitespace-nowrap text-muted-foreground', p.className)} />;
export const TD = (p: React.TdHTMLAttributes<HTMLTableCellElement>) => <td {...p} className={cn('px-3 py-2.5 align-middle', p.className)} />;
