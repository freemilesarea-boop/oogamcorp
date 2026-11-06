import type { Metadata } from 'next';
import { LegalPage, legalMetadata } from '@/components/site/legal-page';


export function generateMetadata(): Promise<Metadata> {
  return legalMetadata('terms', '이용약관', '/terms');
}

export default function TermsPage() {
  return <LegalPage pageKey="terms" label="Terms" fallbackTitle="이용약관" />;
}
