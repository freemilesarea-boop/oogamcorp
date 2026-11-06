import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** 루트 .env 를 단일 설정 소스로 로드 (이미 설정된 환경변수는 덮어쓰지 않음) */
for (const p of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')]) {
  if (existsSync(p)) {
    try {
      process.loadEnvFile(p);
    } catch {
      /* ignore */
    }
    break;
  }
}
