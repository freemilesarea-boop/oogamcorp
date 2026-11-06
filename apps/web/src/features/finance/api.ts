'use client';
import { useQuery } from '@tanstack/react-query';
import { apiGet, csrfToken, type Paginated } from '@/lib/api';
import type { Budget, BudgetLineOption, BusinessUnit, FinanceDashboard, Transaction } from './types';

type Q = Record<string, string | number | undefined>;

export const financeKeys = {
  all: ['finance'] as const,
  dashboard: (year: number) => ['finance', 'dashboard', year] as const,
  units: (all?: boolean) => ['finance', 'business-units', !!all] as const,
  budgets: (q: Q) => ['finance', 'budgets', q] as const,
  budget: (id: string) => ['finance', 'budget', id] as const,
  lineOptions: (year?: number) => ['finance', 'budget-lines', year ?? null] as const,
  transactions: (q: Q) => ['finance', 'transactions', q] as const,
  transaction: (id: string) => ['finance', 'transaction', id] as const,
};

export const useFinanceDashboard = (year: number) =>
  useQuery({ queryKey: financeKeys.dashboard(year), queryFn: () => apiGet<FinanceDashboard>('/finance/dashboard', { year }), retry: false });

export const useBusinessUnits = (includeInactive = false) =>
  useQuery({
    queryKey: financeKeys.units(includeInactive),
    queryFn: () => apiGet<BusinessUnit[]>('/finance/business-units', { includeInactive: includeInactive ? 'true' : undefined }),
    staleTime: 60_000,
    retry: false,
  });

export const useBudgets = (q: Q) =>
  useQuery({ queryKey: financeKeys.budgets(q), queryFn: () => apiGet<Paginated<Budget>>('/finance/budgets', q), retry: false });

export const useBudget = (id: string | null) =>
  useQuery({ queryKey: financeKeys.budget(id ?? ''), queryFn: () => apiGet<Budget>(`/finance/budgets/${id}`), enabled: !!id, retry: false });

export const useBudgetLineOptions = (enabled = true) =>
  useQuery({ queryKey: financeKeys.lineOptions(), queryFn: () => apiGet<BudgetLineOption[]>('/finance/budget-lines'), enabled, retry: false });

export const useTransactions = (q: Q) =>
  useQuery({
    queryKey: financeKeys.transactions(q),
    queryFn: () => apiGet<Paginated<Transaction> & { summary: { revenue: string; expense: string } }>('/finance/transactions', q),
    retry: false,
  });

export const useTransaction = (id: string | null) =>
  useQuery({ queryKey: financeKeys.transaction(id ?? ''), queryFn: () => apiGet<Transaction>(`/finance/transactions/${id}`), enabled: !!id, retry: false });

export interface UploadedFile { id: string; originalName: string; mimeType: string; size: number; url?: string }

/** 공용 파일 API 업로드 (multipart). targetType: APPROVAL | TRANSACTION */
export async function uploadFile(file: File, targetType: 'APPROVAL' | 'TRANSACTION', targetId?: string): Promise<UploadedFile> {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('targetType', targetType);
  if (targetId) fd.append('targetId', targetId);
  const res = await fetch('/api/v1/files', { method: 'POST', body: fd, headers: { 'X-CSRF-Token': csrfToken() ?? '' }, credentials: 'same-origin' });
  const text = await res.text();
  let body: unknown = undefined;
  try { body = text ? JSON.parse(text) : undefined; } catch { body = text; }
  if (!res.ok) {
    const msg = (body as { message?: string | string[] } | undefined)?.message;
    throw new Error(Array.isArray(msg) ? msg.join('\n') : msg ?? `파일 업로드 실패 (${res.status})`);
  }
  return body as UploadedFile;
}
