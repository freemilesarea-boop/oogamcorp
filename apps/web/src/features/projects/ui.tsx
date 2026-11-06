import { PRIORITY_LABELS, PROJECT_STATUS_LABELS, TASK_STATUS_LABELS, type Priority, type ProjectStatus, type TaskStatus } from '@oogam/shared';
import { ArrowDown, ArrowUp, ChevronsUp, Minus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export function TaskStatusBadge({ status, custom }: { status: TaskStatus; custom?: { name: string } | null }) {
  const variant = { TODO: 'muted', IN_PROGRESS: 'info', REVIEW: 'warning', DONE: 'success' } as const;
  return <Badge variant={variant[status]}>{custom?.name ?? TASK_STATUS_LABELS[status]}</Badge>;
}

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  const variant = { PLANNING: 'muted', ACTIVE: 'info', ON_HOLD: 'warning', COMPLETED: 'success', CANCELLED: 'outline' } as const;
  return <Badge variant={variant[status]}>{PROJECT_STATUS_LABELS[status]}</Badge>;
}

export function PriorityIcon({ priority, withLabel }: { priority: Priority; withLabel?: boolean }) {
  const Icon = { LOW: ArrowDown, MEDIUM: Minus, HIGH: ArrowUp, URGENT: ChevronsUp }[priority];
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs', priority === 'URGENT' ? 'text-accent' : priority === 'HIGH' ? 'text-foreground' : 'text-muted-foreground')} title={`우선순위: ${PRIORITY_LABELS[priority]}`}>
      <Icon className="size-3.5" />
      {withLabel && PRIORITY_LABELS[priority]}
    </span>
  );
}

export function ProgressBar({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-muted', className)} role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full bg-foreground transition-all" style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}

export function isOverdue(due: string | null, status: TaskStatus) {
  if (!due || status === 'DONE') return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(due) < today;
}
