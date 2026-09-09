export interface Env {
  DB: D1Database;
  ENVIRONMENT: string;
  PUBLIC_URL?: string;              // base de los enlaces públicos de cotización
  ADMIN_TOKEN?: string;             // secret: crear el primer usuario / rescate
}
