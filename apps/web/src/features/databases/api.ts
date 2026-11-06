'use client';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, apiDelete, apiGet, apiPatch, apiPost, apiPut, type Paginated } from '@/lib/api';
import type { DatabaseDetail, DatabaseSummary, DbProperty, DbRow, DbView, ImportResult, RowsResponse, ViewConfig } from './types';

export const dbKeys = {
  list: (params: object) => ['databases', 'list', params] as const,
  detail: (id: string) => ['databases', id] as const,
  rows: (id: string, params?: object) => (params ? (['databases', id, 'rows', params] as const) : (['databases', id, 'rows'] as const)),
};

export function useDatabases(params: { q?: string; page?: number; pageSize?: number }) {
  return useQuery({
    queryKey: dbKeys.list(params),
    queryFn: () => apiGet<Paginated<DatabaseSummary>>('/databases', { ...params, sort: 'updatedAt', order: 'desc' }),
    placeholderData: keepPreviousData,
  });
}

export function useDatabase(id: string) {
  return useQuery({ queryKey: dbKeys.detail(id), queryFn: () => apiGet<DatabaseDetail>(`/databases/${id}`) });
}

export interface RowParams {
  filters?: ViewConfig['filters'];
  filterMode?: 'and' | 'or';
  sorts?: ViewConfig['sorts'];
  groupBy?: string | null;
  q?: string;
  page?: number;
  pageSize?: number;
}

export function useRows(id: string, p: RowParams, enabled = true) {
  return useQuery({
    queryKey: dbKeys.rows(id, p),
    enabled,
    placeholderData: keepPreviousData,
    queryFn: () =>
      apiGet<RowsResponse>(`/databases/${id}/rows`, {
        filters: p.filters?.length ? JSON.stringify(p.filters) : undefined,
        sorts: p.sorts?.length ? JSON.stringify(p.sorts) : undefined,
        filterMode: p.filterMode,
        groupBy: p.groupBy ?? undefined,
        q: p.q,
        page: p.page,
        pageSize: p.pageSize,
      }),
  });
}

/** 관계 속성 표시용: 대상 DB 의 행(최대 500)과 제목 */
export function useRelationRows(targetId: string | undefined) {
  return useQuery({
    queryKey: ['databases', targetId, 'relation-rows'],
    enabled: !!targetId,
    staleTime: 30_000,
    retry: false,
    queryFn: async () => {
      const [detail, rows] = await Promise.all([
        apiGet<DatabaseDetail>(`/databases/${targetId}`),
        apiGet<RowsResponse>(`/databases/${targetId}/rows`, { pageSize: 500 }),
      ]);
      const title = detail.properties.find((p) => p.type === 'TITLE');
      return { name: detail.name, rows: rows.items.map((r) => ({ id: r.id, title: title ? String(r.cells[title.id] ?? '') : '' })) };
    },
  });
}

const onError = (e: unknown) => toast.error((e as Error).message);

export function useDbMutations(id: string) {
  const qc = useQueryClient();
  const invalidateRows = () => qc.invalidateQueries({ queryKey: dbKeys.rows(id) });
  const invalidateAll = () => Promise.all([qc.invalidateQueries({ queryKey: dbKeys.detail(id) }), invalidateRows()]);

  return {
    invalidateAll,
    updateDatabase: useMutation({
      mutationFn: (body: { name?: string; description?: string | null; icon?: string | null }) => apiPatch(`/databases/${id}`, body),
      onSuccess: invalidateAll,
      onError,
    }),
    createRow: useMutation({
      mutationFn: (cells: Record<string, unknown>) => apiPost<DbRow>(`/databases/${id}/rows`, { cells }),
      onSuccess: invalidateAll,
      onError,
    }),
    updateCells: useMutation({
      mutationFn: ({ rowId, cells }: { rowId: string; cells: Record<string, unknown> }) => apiPatch<DbRow>(`/databases/${id}/rows/${rowId}`, { cells }),
      onSuccess: invalidateRows,
      onError: (e) => {
        onError(e);
        void invalidateRows();
      },
    }),
    deleteRow: useMutation({
      mutationFn: (rowId: string) => apiDelete(`/databases/${id}/rows/${rowId}`),
      onSuccess: () => {
        toast.success('행을 삭제했습니다.');
        void invalidateAll();
      },
      onError,
    }),
    reorderRows: useMutation({
      mutationFn: (orderedIds: string[]) => apiPost(`/databases/${id}/rows/reorder`, { orderedIds }),
      onSuccess: invalidateRows,
      onError,
    }),
    createProperty: useMutation({
      mutationFn: (body: { name: string; type: string; config?: object }) => apiPost<DbProperty>(`/databases/${id}/properties`, body),
      onSuccess: invalidateAll,
      onError,
    }),
    updateProperty: useMutation({
      mutationFn: ({ pid, ...body }: { pid: string; name?: string; type?: string; config?: object }) =>
        apiPatch<DbProperty & { converted: number; cleared: number }>(`/databases/${id}/properties/${pid}`, body),
      onSuccess: (res, vars) => {
        if (vars.type) toast.success(`타입을 변경했습니다. 변환 ${res.converted}건 · 비움 ${res.cleared}건`);
        void invalidateAll();
      },
      onError,
    }),
    deleteProperty: useMutation({
      mutationFn: (pid: string) => apiDelete(`/databases/${id}/properties/${pid}`),
      onSuccess: invalidateAll,
      onError,
    }),
    createView: useMutation({
      mutationFn: (body: { name: string; type: string; personal?: boolean; config?: ViewConfig }) => apiPost<DbView>(`/databases/${id}/views`, body),
      onSuccess: invalidateAll,
      onError,
    }),
    updateView: useMutation({
      mutationFn: ({ viewId, ...body }: { viewId: string; name?: string; config?: ViewConfig }) => apiPatch<DbView>(`/databases/${id}/views/${viewId}`, body),
      onSuccess: invalidateAll,
      onError,
    }),
    deleteView: useMutation({
      mutationFn: (viewId: string) => apiDelete(`/databases/${id}/views/${viewId}`),
      onSuccess: invalidateAll,
      onError,
    }),
    savePreference: useMutation({
      mutationFn: ({ viewId, config }: { viewId: string; config: ViewConfig }) => apiPut(`/databases/${id}/views/${viewId}/preference`, { config }),
      onSuccess: invalidateAll,
      onError,
    }),
    clearPreference: useMutation({
      mutationFn: (viewId: string) => apiDelete(`/databases/${id}/views/${viewId}/preference`),
      onSuccess: invalidateAll,
      onError,
    }),
    importCsv: useMutation({
      mutationFn: ({ file, createMissing }: { file: File; createMissing: boolean }) => {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('createMissing', String(createMissing));
        return api<ImportResult>(`/databases/${id}/import`, { method: 'POST', body: fd });
      },
      onSuccess: invalidateAll,
      onError,
    }),
  };
}

export type DbMutations = ReturnType<typeof useDbMutations>;

/** FILE 속성 업로드 (Files API 계약: POST /files multipart) */
export async function uploadFile(file: File, rowId: string) {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('targetType', 'DATABASE_ROW');
  fd.append('targetId', rowId);
  return api<{ id: string; originalName: string; mimeType: string; size: number; url: string }>('/files', { method: 'POST', body: fd });
}
