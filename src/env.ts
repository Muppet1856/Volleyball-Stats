export interface Env {
  ASSETS: any;
  DB: D1Database;
  Match_DO: DurableObjectNamespace;
  RESEND_API_KEY: string;
  APP_URL: string;
  debug?: string;
  HOME_TEAM?: string;
  JWT_SECRET: string;
}
