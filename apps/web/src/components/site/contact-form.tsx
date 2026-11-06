'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useId, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { cn } from '@/lib/utils';

const CATEGORIES = [
  { value: 'PROJECT', label: '프로젝트 문의' },
  { value: 'PARTNERSHIP', label: '제휴·파트너십' },
  { value: 'CAREER', label: '채용' },
  { value: 'PRESS', label: '언론·미디어' },
  { value: 'GENERAL', label: '기타' },
] as const;

const schema = z.object({
  name: z.string().trim().min(1, '이름을 입력하세요.').max(100, '100자 이내로 입력하세요.'),
  email: z.string().trim().email('올바른 이메일 주소를 입력하세요.').max(254),
  phone: z.string().trim().regex(/^$|^[0-9+()\-\s]{7,20}$/, '올바른 전화번호를 입력하세요.'),
  company: z.string().trim().max(200, '200자 이내로 입력하세요.'),
  category: z.enum(['PROJECT', 'PARTNERSHIP', 'CAREER', 'PRESS', 'GENERAL']),
  message: z.string().trim().min(10, '문의 내용을 10자 이상 입력하세요.').max(5000, '5,000자 이내로 입력하세요.'),
  privacyConsent: z.boolean().refine((v) => v, '개인정보 수집·이용에 동의해 주세요.'),
  website: z.string().max(2000),
});
type Values = z.infer<typeof schema>;

const inputCls =
  'block w-full border-0 border-b border-gray-300 bg-transparent px-0 py-3 text-lg text-ink placeholder:text-gray-400 transition-colors focus:border-ink focus:outline-none focus:ring-0 aria-[invalid=true]:border-red-600';

function FieldWrap({ id, label, required, error, children, className }: { id: string; label: string; required?: boolean; error?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label htmlFor={id} className="text-[11px] font-medium uppercase tracking-[0.18em] text-gray-500">
        {label}{required && <span aria-hidden className="ml-1 text-ink">*</span>}
      </label>
      {children}
      {error && <p id={`${id}-error`} role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}

/** 공개 문의 폼 — 동일 출처 /api/v1/public/inquiries 로 전송 (허니팟 + 개인정보 동의 필수) */
export function ContactForm() {
  const uid = useId();
  const id = (n: string) => `${uid}-${n}`;
  const [state, setState] = useState<'idle' | 'success' | 'error'>('idle');
  const [serverError, setServerError] = useState<string | null>(null);
  const { register, handleSubmit, formState, reset } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', email: '', phone: '', company: '', category: 'PROJECT', message: '', privacyConsent: false, website: '' },
  });
  const { errors, isSubmitting } = formState;
  const aria = (n: keyof Values) => ({ 'aria-invalid': errors[n] ? true : undefined, 'aria-describedby': errors[n] ? `${id(n)}-error` : undefined });

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      const res = await fetch('/api/v1/public/inquiries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          ...values,
          phone: values.phone || undefined,
          company: values.company || undefined,
          website: values.website || undefined,
        }),
      });
      if (res.ok) {
        setState('success');
        reset();
        return;
      }
      if (res.status === 429) throw new Error('요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.');
      const body = (await res.json().catch(() => null)) as { message?: string | string[] } | null;
      const msg = Array.isArray(body?.message) ? body.message.join('\n') : body?.message;
      throw new Error(res.status === 400 && msg ? msg : '문의 접수에 실패했습니다. 잠시 후 다시 시도해 주세요.');
    } catch (e) {
      setState('error');
      setServerError(e instanceof Error && e.message !== 'Failed to fetch' ? e.message : '네트워크 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.');
    }
  });

  if (state === 'success') {
    return (
      <div role="status" className="border-t border-ink py-16">
        <p className="text-3xl font-semibold tracking-[-0.03em] md:text-4xl">문의가 접수되었습니다.</p>
        <p className="mt-4 max-w-md leading-relaxed text-gray-600">남겨주신 연락처로 담당자가 확인 후 회신드리겠습니다. 감사합니다.</p>
        <button type="button" onClick={() => setState('idle')} className="mt-10 border-b border-ink pb-0.5 text-sm font-medium">
          새 문의 작성
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="grid grid-cols-1 gap-x-8 gap-y-10 md:grid-cols-2">
      <FieldWrap id={id('name')} label="이름" required error={errors.name?.message}>
        <input id={id('name')} autoComplete="name" className={inputCls} {...aria('name')} {...register('name')} />
      </FieldWrap>
      <FieldWrap id={id('email')} label="이메일" required error={errors.email?.message}>
        <input id={id('email')} type="email" autoComplete="email" inputMode="email" className={inputCls} {...aria('email')} {...register('email')} />
      </FieldWrap>
      <FieldWrap id={id('phone')} label="연락처" error={errors.phone?.message}>
        <input id={id('phone')} type="tel" autoComplete="tel" inputMode="tel" className={inputCls} {...aria('phone')} {...register('phone')} />
      </FieldWrap>
      <FieldWrap id={id('company')} label="회사·소속" error={errors.company?.message}>
        <input id={id('company')} autoComplete="organization" className={inputCls} {...aria('company')} {...register('company')} />
      </FieldWrap>
      <fieldset className="md:col-span-2">
        <legend className="text-[11px] font-medium uppercase tracking-[0.18em] text-gray-500">문의 유형</legend>
        <div className="mt-4 flex flex-wrap gap-2">
          {CATEGORIES.map((c) => (
            <label key={c.value} className="cursor-pointer">
              <input type="radio" value={c.value} className="peer sr-only" {...register('category')} />
              <span className="inline-block rounded-full border border-gray-300 px-4 py-2 text-sm text-gray-600 transition-colors peer-checked:border-ink peer-checked:bg-ink peer-checked:text-white peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink hover:border-ink">
                {c.label}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <FieldWrap id={id('message')} label="문의 내용" required error={errors.message?.message} className="md:col-span-2">
        <textarea id={id('message')} rows={6} className={cn(inputCls, 'resize-y')} {...aria('message')} {...register('message')} />
      </FieldWrap>

      {/* 허니팟: 화면·보조기기에서 숨김. 사람은 입력하지 않는다 */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden" >
        <label htmlFor={id('website')}>Website</label>
        <input id={id('website')} tabIndex={-1} autoComplete="off" {...register('website')} />
      </div>

      <div className="md:col-span-2">
        <label className="flex cursor-pointer items-start gap-3 text-sm leading-relaxed text-gray-700">
          <input
            type="checkbox"
            className="mt-1 size-4 shrink-0 accent-ink"
            {...aria('privacyConsent')}
            {...register('privacyConsent')}
          />
          <span>
            (필수) 문의 응대를 위한 개인정보(이름, 이메일, 연락처, 회사, 문의 내용) 수집·이용에 동의합니다.{' '}
            <Link href="/privacy" target="_blank" className="font-medium text-ink underline underline-offset-4">개인정보처리방침 보기</Link>
          </span>
        </label>
        {errors.privacyConsent && <p id={`${id('privacyConsent')}-error`} role="alert" className="mt-2 text-sm text-red-600">{errors.privacyConsent.message}</p>}
      </div>

      {state === 'error' && serverError && (
        <p role="alert" className="whitespace-pre-line border-l-2 border-red-600 pl-4 text-sm text-red-700 md:col-span-2">{serverError}</p>
      )}

      <div className="md:col-span-2">
        <button
          type="submit"
          disabled={isSubmitting}
          className="group inline-flex h-14 items-center gap-4 rounded-full bg-ink px-9 text-base font-semibold text-white transition-opacity hover:opacity-85 disabled:opacity-50"
        >
          {isSubmitting ? '전송 중…' : '문의 보내기'}
          <span aria-hidden className="transition-transform duration-300 group-hover:translate-x-1">→</span>
        </button>
      </div>
    </form>
  );
}
