import { APPROVAL_STATUS_LABELS, type ApprovalStatus } from '@oogam/shared';
import { Badge } from '@/components/ui/badge';

export function ApprovalStatusBadge({ status }: { status: ApprovalStatus }) {
  const v = { DRAFT: 'muted', PENDING: 'info', APPROVED: 'success', REJECTED: 'danger', CHANGES_REQUESTED: 'warning', CANCELLED: 'outline' } as const;
  return <Badge variant={v[status]}>{APPROVAL_STATUS_LABELS[status]}</Badge>;
}
