/**
 * FORMULA / ROLLUP 속성 확장 설계 (후속 구현 — 현재는 생성 시 400 "후속 구현" 오류를 반환한다).
 *
 * 설계
 * 1) 저장: DatabaseProperty.config 에
 *    - FORMULA: { expression: string, resultType: 'TEXT'|'NUMBER'|'DATE'|'CHECKBOX' }
 *    - ROLLUP:  { relationPropertyId, targetPropertyId, aggregate: 'count'|'sum'|'avg'|'min'|'max'|'show_unique' }
 *    셀(DatabaseCell)에는 값을 저장하지 않는다(계산 값). 필요 시 캐시 테이블/물질화는 별도 도입.
 * 2) 파서: expression 을 AST 로 파싱(prop("이름"), 산술/비교/논리 연산, if(), concat(), dateAdd() 등 화이트리스트 함수만).
 *    eval/new Function 사용 금지. 파싱 시 참조 속성 ID 를 해석해 순환 참조(FORMULA→FORMULA)를 DAG 검사로 거부한다.
 * 3) 평가: RowsService.list 에서 필터/정렬 전에 evaluateRow 로 계산 값을 cells 에 주입 →
 *    기존 query.ts 의 필터·정렬 엔진을 resultType 기준으로 재사용한다.
 * 4) ROLLUP: RELATION 셀의 행 ID 목록으로 대상 DB 셀을 일괄 조회(행 단위 N+1 금지) 후 aggregate.
 *    대상 DB 에 대한 사용자의 열람 권한이 없으면 값은 null 로 마스킹한다.
 * 5) 보안/성능: 식 길이 ≤ 2,000자, AST 노드 ≤ 500, 평가 단계 제한, 타임아웃 없는 동기 평가.
 */
export type FormulaResultType = 'TEXT' | 'NUMBER' | 'DATE' | 'CHECKBOX';

export interface FormulaConfig {
  expression: string;
  resultType: FormulaResultType;
}

export interface RollupConfig {
  relationPropertyId: string;
  targetPropertyId: string;
  aggregate: 'count' | 'sum' | 'avg' | 'min' | 'max' | 'show_unique';
}

export interface FormulaContext {
  /** 같은 행의 다른 속성 값 (propertyId → 정규화된 셀 값) */
  cells: Record<string, unknown>;
  /** 속성 이름 → ID (prop("이름") 해석용) */
  propertyIdsByName: Map<string, string>;
  now: Date;
}

export interface FormulaEvaluator {
  /** 식을 검증하고 참조 속성 ID 목록을 반환 (저장 시 호출, 오류 시 BadRequest) */
  compile(config: FormulaConfig, ctx: Pick<FormulaContext, 'propertyIdsByName'>): { dependencies: string[] };
  /** 한 행에 대한 계산 값. 오류는 null 로 처리하고 UI 에 "#ERROR" 표시 */
  evaluate(config: FormulaConfig, ctx: FormulaContext): string | number | boolean | { start: string } | null;
}

export interface RollupEvaluator {
  evaluate(config: RollupConfig, relatedValues: unknown[]): number | string | null;
}
