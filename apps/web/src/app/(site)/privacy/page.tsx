import type { Metadata } from 'next';
import { LegalPage, legalMetadata } from '@/components/site/legal-page';


export function generateMetadata(): Promise<Metadata> {
  return legalMetadata('privacy', '개인정보처리방침', '/privacy');
}

export default function PrivacyPage() {
  return <LegalPage pageKey="privacy" label="Privacy" fallbackTitle="개인정보처리방침" />;
}
