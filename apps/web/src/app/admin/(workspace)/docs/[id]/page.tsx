'use client';
import { useParams } from 'next/navigation';
import { DocPage } from '@/features/docs/doc-page';

export default function DocumentPage() {
  const { id } = useParams<{ id: string }>();
  return <DocPage id={id} />;
}
