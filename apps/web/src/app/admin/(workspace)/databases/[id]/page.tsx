import { Suspense } from 'react';
import { LoadingRows } from '@/components/admin/states';
import { DatabasePage } from '@/features/databases/database-page';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={<LoadingRows rows={8} />}>
      <DatabasePage key={id} id={id} />
    </Suspense>
  );
}
