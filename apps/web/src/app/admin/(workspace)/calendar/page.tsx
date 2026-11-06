import { Suspense } from 'react';
import { LoadingRows } from '@/components/admin/states';
import { CalendarPage } from '@/features/calendar/calendar-page';

export default function Page() {
  return (
    <Suspense fallback={<LoadingRows rows={8} />}>
      <CalendarPage />
    </Suspense>
  );
}
