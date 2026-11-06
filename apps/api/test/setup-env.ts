import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../../../.env');
if (existsSync(root)) process.loadEnvFile(root);
process.env.NODE_ENV = 'test';
// 테스트 전용 DB (작업자별로 TEST_DATABASE_URL 로 분리 가능)
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://oogam:oogam_dev_pw@localhost:5432/oogam_test?schema=public';
process.env.COOKIE_SECURE = 'false';
process.env.SWAGGER_ENABLED = 'false';
process.env.SMTP_ENABLED = 'false';
process.env.STORAGE_DRIVER = 'local';
process.env.STORAGE_LOCAL_DIR = resolve(__dirname, '../.test-storage');
