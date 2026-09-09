// Cuentas del portal: contraseñas, sesiones por cookie y freno a fuerza bruta.
// Copiado de wa/src/auth.ts (la bandeja del gateway); cambia solo el nombre de la cookie.
//
// Todo con WebCrypto, sin dependencias. La contraseña se guarda como PBKDF2-SHA256
// (100k iteraciones, sal por usuario). La sesión es un token aleatorio de 32 bytes
// que viaja en una cookie HttpOnly; en D1 solo se guarda su SHA-256, así que leer
// la tabla no sirve para suplantar a nadie.
import type { Env } from './env';

export interface User {
  id: number;
  email: string;
  name: string;
  role: 'admin' | 'vendedor';
  active: number;
}

const PBKDF2_ITER = 100_000;
const SESSION_DAYS = 30;
export const COOKIE = 'tratto_portal';

// ── contraseñas ────────────────────────────────────────────────────────────────

function b64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}
function unb64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}

async function pbkdf2(password: string, salt: Uint8Array, iter: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITER);
  return `pbkdf2$${PBKDF2_ITER}$${b64(salt)}$${b64(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, iterS, saltS, hashS] = stored.split('$');
  if (algo !== 'pbkdf2' || !iterS || !saltS || !hashS) return false;
  const want = unb64(hashS);
  const got = await pbkdf2(password, unb64(saltS), Number(iterS));
  if (want.length !== got.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want[i] ^ got[i];
  return diff === 0;
}

/** Reglas mínimas. No hay recuperación por correo: la contraseña la pone un admin. */
export function passwordProblem(pw: string): string | null {
  if (typeof pw !== 'string' || pw.length < 8) return 'la contraseña debe tener al menos 8 caracteres';
  if (pw.length > 200) return 'contraseña demasiado larga';
  return null;
}

// ── sesiones ───────────────────────────────────────────────────────────────────

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return b64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function createSession(env: Env, userId: number): Promise<string> {
  const token = randomToken();
  await env.DB.prepare(
    `INSERT INTO sessions (token_hash, user_id, expires_at)
     VALUES (?1, ?2, datetime('now', ?3))`,
  ).bind(await sha256Hex(token), userId, `+${SESSION_DAYS} days`).run();
  await env.DB.prepare(`UPDATE users SET last_login_at = datetime('now') WHERE id = ?`)
    .bind(userId).run();
  return token;
}

export async function destroySession(env: Env, token: string): Promise<void> {
  await env.DB.prepare(`DELETE FROM sessions WHERE token_hash = ?`)
    .bind(await sha256Hex(token)).run();
}

function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.get('cookie') ?? '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export function sessionToken(req: Request): string | null {
  return readCookie(req, COOKIE);
}

/** Usuario de la sesión de la cookie, o null. Renueva `last_used` de paso. */
export async function sessionUser(env: Env, req: Request): Promise<User | null> {
  const token = sessionToken(req);
  if (!token) return null;
  const hash = await sha256Hex(token);
  const row = await env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.role, u.active
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?1 AND s.expires_at > datetime('now') AND u.active = 1`,
  ).bind(hash).first<User>();
  if (!row) return null;
  // Sin esperar: es cosmético y no queremos alargar cada request por esto.
  env.DB.prepare(`UPDATE sessions SET last_used = datetime('now') WHERE token_hash = ?`)
    .bind(hash).run().catch(() => {});
  return row;
}

export function sessionCookie(env: Env, token: string | null): string {
  // Path=/: aquí todo el sitio es la app (la página pública /c/ no la lee). Secure solo en prod,
  // porque en `wrangler dev` la página se abre por http.
  const base = `${COOKIE}=${token ? encodeURIComponent(token) : ''}; Path=/; HttpOnly; SameSite=Lax`;
  const secure = env.ENVIRONMENT === 'prod' ? '; Secure' : '';
  const age = token ? `; Max-Age=${SESSION_DAYS * 86400}` : '; Max-Age=0';
  return base + secure + age;
}

// ── login ──────────────────────────────────────────────────────────────────────

const MAX_FAILS = 8;          // por correo
const FAIL_WINDOW = '-15 minutes';

export async function tooManyAttempts(env: Env, email: string): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT count(*) AS n FROM login_attempts WHERE email = ?1 AND at > datetime('now', ?2)`,
  ).bind(email, FAIL_WINDOW).first<{ n: number }>();
  return (row?.n ?? 0) >= MAX_FAILS;
}

export async function recordFailure(env: Env, email: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO login_attempts (email) VALUES (?)`).bind(email),
    env.DB.prepare(`DELETE FROM login_attempts WHERE at < datetime('now', '-1 day')`),
  ]);
}

export function normalizeEmail(e: unknown): string {
  return String(e ?? '').trim().toLowerCase();
}

export function validEmail(e: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 200;
}

/** Correo + contraseña → usuario, o null. Aplica el freno a fuerza bruta. */
export async function login(
  env: Env, emailRaw: unknown, password: unknown,
): Promise<{ user: User } | { error: string; status: number }> {
  const email = normalizeEmail(emailRaw);
  if (!email || typeof password !== 'string' || !password) {
    return { error: 'correo y contraseña requeridos', status: 400 };
  }
  if (await tooManyAttempts(env, email)) {
    return { error: 'demasiados intentos; espera 15 minutos', status: 429 };
  }
  const row = await env.DB.prepare(
    `SELECT id, email, name, role, active, password_hash FROM users WHERE email = ?`,
  ).bind(email).first<User & { password_hash: string }>();

  // Se verifica contra un hash aunque el usuario no exista, para que el tiempo de
  // respuesta no delate qué correos están dados de alta.
  const ok = row
    ? await verifyPassword(password, row.password_hash)
    : await verifyPassword(password, DUMMY_HASH).then(() => false);

  if (!ok || !row || !row.active) {
    await recordFailure(env, email);
    return { error: 'correo o contraseña incorrectos', status: 401 };
  }
  const { password_hash: _drop, ...user } = row;
  return { user };
}

const DUMMY_HASH = 'pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
