/**
 * 환경 기반 설정. 비밀값은 반드시 환경변수로 주입하며 코드에 하드코딩하지 않는다.
 * 운영(production)에서는 필수 값이 없으면 기동을 중단한다.
 */
export interface AppConfig {
  env: 'development' | 'test' | 'staging' | 'production';
  port: number;
  collabPort: number;
  databaseUrl: string;
  redisUrl: string;
  webOrigins: string[];
  cookie: { secure: boolean; domain?: string; sessionName: string; csrfName: string };
  session: { ttlHours: number; idleMinutes: number };
  login: { maxFailures: number; lockMinutes: number };
  storage: {
    driver: 's3' | 'local';
    localDir: string;
    s3Endpoint?: string;
    s3Region: string;
    s3Bucket: string;
    s3AccessKey?: string;
    s3SecretKey?: string;
    s3ForcePathStyle: boolean;
    maxUploadMb: number;
  };
  smtp: { enabled: boolean; host?: string; port: number; user?: string; pass?: string; from?: string };
  ipHashSalt: string;
  swaggerEnabled: boolean;
  logLevel: string;
}

function bool(v: string | undefined, d: boolean): boolean {
  if (v === undefined || v === '') return d;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

let cached: AppConfig | null = null;

export function loadConfig(): AppConfig {
  if (cached) return cached;
  const env = (process.env.NODE_ENV ?? 'development') as AppConfig['env'];
  const isProd = env === 'production' || env === 'staging';
  const required = (key: string, devDefault?: string): string => {
    const v = process.env[key];
    if (v && v.length > 0) return v;
    if (!isProd && devDefault !== undefined) return devDefault;
    throw new Error(`필수 환경변수 누락: ${key}`);
  };

  cached = {
    env,
    port: Number(process.env.API_PORT ?? 4000),
    collabPort: Number(process.env.COLLAB_PORT ?? 4001),
    databaseUrl: required('DATABASE_URL'),
    redisUrl: required('REDIS_URL', 'redis://localhost:6379'),
    webOrigins: (process.env.WEB_ORIGINS ?? 'http://localhost:3000').split(',').map((s) => s.trim()).filter(Boolean),
    cookie: {
      secure: bool(process.env.COOKIE_SECURE, isProd),
      domain: process.env.COOKIE_DOMAIN || undefined,
      sessionName: isProd && bool(process.env.COOKIE_SECURE, true) ? '__Host-oogam_session' : 'oogam_session',
      csrfName: 'oogam_csrf',
    },
    session: {
      ttlHours: Number(process.env.SESSION_TTL_HOURS ?? 12),
      idleMinutes: Number(process.env.SESSION_IDLE_MINUTES ?? 120),
    },
    login: {
      maxFailures: Number(process.env.LOGIN_MAX_FAILURES ?? 5),
      lockMinutes: Number(process.env.LOGIN_LOCK_MINUTES ?? 15),
    },
    storage: {
      driver: (process.env.STORAGE_DRIVER as 's3' | 'local') ?? 'local',
      localDir: process.env.STORAGE_LOCAL_DIR ?? './storage',
      s3Endpoint: process.env.S3_ENDPOINT || undefined,
      s3Region: process.env.S3_REGION ?? 'ap-northeast-2',
      s3Bucket: process.env.S3_BUCKET ?? 'oogam',
      s3AccessKey: process.env.S3_ACCESS_KEY || undefined,
      s3SecretKey: process.env.S3_SECRET_KEY || undefined,
      s3ForcePathStyle: bool(process.env.S3_FORCE_PATH_STYLE, true),
      maxUploadMb: Number(process.env.MAX_UPLOAD_MB ?? 25),
    },
    smtp: {
      enabled: bool(process.env.SMTP_ENABLED, false),
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
      from: process.env.SMTP_FROM,
    },
    ipHashSalt: required('IP_HASH_SALT', 'dev-only-ip-salt'),
    swaggerEnabled: bool(process.env.SWAGGER_ENABLED, !isProd),
    logLevel: process.env.LOG_LEVEL ?? (isProd ? 'info' : 'debug'),
  };
  return cached;
}

/** 테스트에서 환경변수를 바꾼 뒤 설정을 다시 읽기 위해 사용 */
export function resetConfigCache(): void {
  cached = null;
}
