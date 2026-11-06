import { DevStatus, PageHeader } from '@/components/admin/states';

export default function Page() {
  return (
    <>
      <PageHeader title="내 업무" />
      <DevStatus status="NOT_STARTED">이 화면은 아직 구현되지 않았습니다. IMPLEMENTATION_STATUS.md 를 참고하세요.</DevStatus>
    </>
  );
}
