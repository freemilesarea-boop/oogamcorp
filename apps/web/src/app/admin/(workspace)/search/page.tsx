import { Suspense } from 'react';
import { LoadingRows } from '@/components/admin/states';
import { SearchPage } from '@/features/search/search-page';

export default function Page() {
  return (
    <Suspense fallback={<LoadingRows rows={6} />}>
      <SearchPage />
    </Suspense>
  );
}
