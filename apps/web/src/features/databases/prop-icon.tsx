import { AlignLeft, Calendar, CheckSquare, ChevronDownCircle, Hash, Link2, List, Paperclip, Sigma, Type, User, ArrowUpRight } from 'lucide-react';
import type { PropType } from './types';

const ICONS: Record<PropType, typeof Type> = {
  TITLE: Type, TEXT: AlignLeft, NUMBER: Hash, SELECT: ChevronDownCircle, MULTI_SELECT: List, DATE: Calendar, CHECKBOX: CheckSquare,
  PERSON: User, URL: Link2, FILE: Paperclip, RELATION: ArrowUpRight, FORMULA: Sigma, ROLLUP: Sigma,
};

export function PropIcon({ type, className = 'size-3.5' }: { type: PropType; className?: string }) {
  const Icon = ICONS[type] ?? Type;
  return <Icon className={className} aria-hidden />;
}
