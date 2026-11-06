import type { DbPropertyType as SharedPropType } from '@oogam/shared';

export type PropType = SharedPropType | 'FORMULA' | 'ROLLUP';
export type ViewType = 'TABLE' | 'BOARD' | 'CALENDAR' | 'LIST' | 'GALLERY' | 'TIMELINE';

export interface SelectOption { id: string; name: string; color: string }
export interface PropertyConfig {
  options?: SelectOption[];
  format?: 'number' | 'integer' | 'percent' | 'currency_krw' | 'currency_usd';
  targetDatabaseId?: string;
  includeTime?: boolean;
}

export interface DbProperty {
  id: string;
  name: string;
  type: PropType;
  config: PropertyConfig;
  position: number;
  isPrimary: boolean;
}

export interface Filter { propertyId: string; operator: string; value?: unknown }
export interface Sort { propertyId: string; direction: 'asc' | 'desc' }
export interface ViewConfig {
  filters?: Filter[];
  filterMode?: 'and' | 'or';
  sorts?: Sort[];
  groupBy?: string | null;
  visibleProperties?: string[];
  datePropertyId?: string | null;
  propertyWidths?: Record<string, number>;
}

export interface DbView {
  id: string;
  name: string;
  type: ViewType;
  config: ViewConfig;
  ownerId: string | null;
  personal: boolean;
  preference: ViewConfig | null;
  position: number;
}

export interface DatabaseSummary {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  workspace: { id: string; name: string };
  rowCount: number;
  propertyCount: number;
  updatedAt: string;
  createdAt: string;
}

export interface DatabaseDetail extends Omit<DatabaseSummary, 'propertyCount'> {
  properties: DbProperty[];
  views: DbView[];
  access: { canEdit: boolean };
}

export interface DbRow {
  id: string;
  position: number;
  createdAt: string;
  updatedAt: string;
  createdById: string;
  cells: Record<string, unknown>;
}

export interface RowsResponse {
  items: DbRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  groupBy: string | null;
  groups?: { key: string | null; count: number }[];
}

export interface ImportResult {
  imported: number;
  failedRows: number;
  createdProperties: string[];
  errors: { row: number; column?: string; message: string }[];
}

export const OPTION_COLORS: Record<string, string> = {
  gray: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200',
  brown: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  orange: 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200',
  yellow: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-200',
  green: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200',
  blue: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200',
  purple: 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-200',
  pink: 'bg-pink-100 text-pink-800 dark:bg-pink-950 dark:text-pink-200',
  red: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200',
};
export const OPTION_COLOR_LABELS: Record<string, string> = {
  gray: '회색', brown: '갈색', orange: '주황', yellow: '노랑', green: '초록', blue: '파랑', purple: '보라', pink: '분홍', red: '빨강',
};

export const VIEW_TYPE_LABELS: Record<ViewType, string> = {
  TABLE: '표', BOARD: '보드', CALENDAR: '캘린더', LIST: '리스트', GALLERY: '갤러리', TIMELINE: '타임라인',
};

export const NUMBER_FORMAT_LABELS: Record<NonNullable<PropertyConfig['format']>, string> = {
  number: '숫자', integer: '정수', percent: '퍼센트', currency_krw: '원화(₩)', currency_usd: '달러($)',
};

export const OPERATORS: Record<string, { value: string; label: string }[]> = (() => {
  const text = [
    { value: 'contains', label: '포함' }, { value: 'not_contains', label: '포함하지 않음' }, { value: 'equals', label: '같음' },
    { value: 'not_equals', label: '같지 않음' }, { value: 'starts_with', label: '시작 문자' },
    { value: 'is_empty', label: '비어 있음' }, { value: 'is_not_empty', label: '비어 있지 않음' },
  ];
  const empty = [{ value: 'is_empty', label: '비어 있음' }, { value: 'is_not_empty', label: '비어 있지 않음' }];
  const has = [{ value: 'contains', label: '포함' }, { value: 'not_contains', label: '포함하지 않음' }, ...empty];
  return {
    TITLE: text,
    TEXT: text,
    URL: text.filter((o) => o.value !== 'starts_with'),
    NUMBER: [
      { value: 'equals', label: '=' }, { value: 'not_equals', label: '≠' }, { value: 'gt', label: '>' }, { value: 'gte', label: '≥' },
      { value: 'lt', label: '<' }, { value: 'lte', label: '≤' }, ...empty,
    ],
    SELECT: [{ value: 'equals', label: '같음' }, { value: 'not_equals', label: '같지 않음' }, ...empty],
    MULTI_SELECT: has,
    PERSON: has,
    RELATION: has,
    FILE: empty,
    CHECKBOX: [{ value: 'is_checked', label: '체크됨' }, { value: 'is_not_checked', label: '체크 안 됨' }],
    DATE: [
      { value: 'equals', label: '같은 날' }, { value: 'before', label: '이전' }, { value: 'after', label: '이후' },
      { value: 'on_or_before', label: '당일 또는 이전' }, { value: 'on_or_after', label: '당일 또는 이후' }, ...empty,
    ],
  };
})();
export const NO_VALUE_OPERATORS = ['is_empty', 'is_not_empty', 'is_checked', 'is_not_checked'];
