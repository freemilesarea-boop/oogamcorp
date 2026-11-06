'use client';
import * as AvatarPrimitive from '@radix-ui/react-avatar';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { Check } from 'lucide-react';
import * as React from 'react';
import { cn } from '@/lib/utils';

export function Avatar({ name, src, className }: { name?: string | null; src?: string | null; className?: string }) {
  const initials = (name ?? '?').trim().slice(0, 2).toUpperCase();
  return (
    <AvatarPrimitive.Root className={cn('relative inline-flex size-7 shrink-0 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800', className)} title={name ?? undefined}>
      {src && <AvatarPrimitive.Image src={src} alt={name ?? ''} className="size-full object-cover" />}
      <AvatarPrimitive.Fallback className="flex size-full items-center justify-center text-[10px] font-semibold">{initials}</AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}

export function AvatarStack({ users, max = 4 }: { users: { id: string; name: string; avatarUrl?: string | null }[]; max?: number }) {
  return (
    <div className="flex -space-x-1.5">
      {users.slice(0, max).map((u) => <Avatar key={u.id} name={u.name} src={u.avatarUrl} className="size-6 ring-2 ring-background" />)}
      {users.length > max && <span className="flex size-6 items-center justify-center rounded-full bg-muted text-[10px] ring-2 ring-background">+{users.length - max}</span>}
    </div>
  );
}

export const Checkbox = React.forwardRef<React.ElementRef<typeof CheckboxPrimitive.Root>, React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>>(
  ({ className, ...props }, ref) => (
    <CheckboxPrimitive.Root
      ref={ref}
      className={cn('peer size-4 shrink-0 rounded-[4px] border border-gray-400 data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground', className)}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center"><Check className="size-3" strokeWidth={3} /></CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  ),
);
Checkbox.displayName = 'Checkbox';

export const Switch = React.forwardRef<React.ElementRef<typeof SwitchPrimitive.Root>, React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>>(
  ({ className, ...props }, ref) => (
    <SwitchPrimitive.Root ref={ref} className={cn('inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full bg-gray-300 transition-colors data-[state=checked]:bg-primary dark:bg-gray-700', className)} {...props}>
      <SwitchPrimitive.Thumb className="block size-4 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[18px] dark:data-[state=checked]:bg-gray-900" />
    </SwitchPrimitive.Root>
  ),
);
Switch.displayName = 'Switch';

export function Separator({ className, vertical }: { className?: string; vertical?: boolean }) {
  return <div role="separator" className={cn('shrink-0 bg-border', vertical ? 'h-full w-px' : 'h-px w-full', className)} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} />;
}

export const TooltipProvider = TooltipPrimitive.Provider;
export function Tooltip({ content, children, side = 'right' }: { content: React.ReactNode; children: React.ReactNode; side?: 'top' | 'right' | 'bottom' | 'left' }) {
  return (
    <TooltipPrimitive.Root delayDuration={300}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content side={side} sideOffset={6} className="z-50 rounded-md bg-ink px-2 py-1 text-xs text-white dark:bg-white dark:text-ink">{content}</TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cn('inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent', className)} role="status" aria-label="로딩 중" />;
}
