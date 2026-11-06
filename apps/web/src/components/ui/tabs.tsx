'use client';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import * as React from 'react';
import { cn } from '@/lib/utils';

export const Tabs = TabsPrimitive.Root;
export function TabsList({ className, ...props }: React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List className={cn('inline-flex h-9 max-w-full items-center gap-1 overflow-x-auto rounded-lg bg-muted p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden', className)} {...props} />;
}
/** noPanel: 탭을 목록 필터로만 쓰고 TabsContent 가 없을 때 — 존재하지 않는 패널을 가리키는 aria-controls 제거 */
export function TabsTrigger({ className, noPanel, ...props }: React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger> & { noPanel?: boolean }) {
  return (
    <TabsPrimitive.Trigger
      className={cn('inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1 text-[13px] font-medium text-muted-foreground transition-colors data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm [&_svg]:size-3.5', className)}
      {...props}
      {...(noPanel ? { 'aria-controls': undefined } : {})}
    />
  );
}
export function TabsContent({ className, ...props }: React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn('mt-4 focus-visible:outline-none', className)} {...props} />;
}
