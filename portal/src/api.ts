// API del portal (con sesión). La página (app-html.ts) es la única que la usa.
//
//   GET  /api/me                         quién soy + ajustes + listas de etapas
//   GET  /api/board                      todas las oportunidades con cliente y totales
//   POST /api/oportunidades              crear (cliente existente o nuevo) con líneas del catálogo
//   GET  /api/oportunidades/:id          encabezado + cliente + contactos + líneas + vistas + catálogo
//   POST /api/oportunidades/:id          guardar encabezado + líneas (reemplaza todas)
//   POST /api/oportunidades/:id/etapa    nueva | cotizada | negociacion | ganada | perdida (ganada crea el proyecto)
//   POST /api/oportunidades/:id/duplicar
//   POST /api/oportunidades/:id/eliminar
//   GET  /api/proyectos · POST /api/proyectos/:id · POST /api/proyectos/:id/eliminar
//   GET  /api/clientes?q= · POST /api/clientes · GET/POST /api/clientes/:id · POST /api/clientes/:id/eliminar
//   POST /api/contactos · POST /api/contactos/:id · POST /api/contactos/:id/eliminar
//   GET  /api/catalogo · POST /api/catalogo · POST /api/catalogo/:id/eliminar
//   POST /api/ajustes · POST /api/password
import type { Env } from './env';
import { hashPassword, passwordProblem, verifyPassword, type User } from './auth';

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers });

export async function body<T>(req: Request): Promise<T | null> {
  // Todo lo que muta viene como JSON desde la página. Exigir el content-type es un
  // freno barato extra contra CSRF (un <form> no puede mandarlo).
  if (!(req.headers.get('content-type') ?? '').includes('application/json')) return null;
  try { return await req.json<T>(); } catch { return null; }
}

export const ETAPAS = ['nueva', 'cotizada', 'negociacion', 'ganada', 'perdida'] as const;
export const ESTADOS_PROYECTO = ['entrevistas', 'construccion', 'arranque', 'en_renta', 'terminado'] as const;
export const PERIODICIDADES = ['unico', 'mensual'] as const;

export interface Linea {
  id?: number;
  orden: number;
  periodicidad: 'unico' | 'mensual';
  concepto: string;
  descripcion: string | null;
  cantidad: number;
  precio: number;
}
export interface Bloque { subtotal: number; iva: number; total: number; lineas: number }
export interface Totales { unico: Bloque; mensual: Bloque }

/** Dos bloques: lo que se paga una vez y lo que se paga cada mes. IVA en por ciento
 *  sobre el subtotal de cada bloque, redondeado a centavos. */
export function totales(lineas: Linea[], ivaPct: number): Totales {
  const mk = (): Bloque => ({ subtotal: 0, iva: 0, total: 0, lineas: 0 });
  const t: Totales = { unico: mk(), mensual: mk() };
  for (const l of lineas) {
    const b = l.periodicidad === 'unico' ? t.unico : t.mensual;
    b.subtotal += (Number(l.cantidad) || 0) * (Number(l.precio) || 0);
    b.lineas++;
  }
  for (const b of [t.unico, t.mensual]) {
    b.subtotal = Math.round(b.subtotal * 100) / 100;
    b.iva = Math.round(b.subtotal * ivaPct) / 100;
    b.total = Math.round((b.subtotal + b.iva) * 100) / 100;
  }
  return t;
}

// ── helpers ────────────────────────────────────────────────────────────────────

const str = (v: unknown, max = 500): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};
const num = (v: unknown, def = 0): number => { const n = Number(v); return Number.isFinite(n) ? n : def; };
const oneOf = <T extends readonly string[]>(v: unknown, list: T, def: T[number]): T[number] =>
  (list as readonly string[]).includes(String(v)) ? (String(v) as T[number]) : def;
const hoy = () => new Date().toISOString().slice(0, 10);

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function ajustes(env: Env): Promise<Record<string, string>> {
  const rows = await env.DB.prepare(`SELECT clave, valor FROM ajustes`).all<{ clave: string; valor: string }>();
  const out: Record<string, string> = {};
  for (const r of rows.results) out[r.clave] = r.valor;
  return out;
}

export async function lineasDe(env: Env, oppId: number): Promise<Linea[]> {
  const rows = await env.DB.prepare(
    `SELECT id, orden, periodicidad, concepto, descripcion, cantidad, precio FROM lineas WHERE oportunidad_id = ? ORDER BY orden, id`,
  ).bind(oppId).all<Linea>();
  return rows.results;
}

/** Siguiente folio de una tabla: prefijo + número de 4 cifras, tomando el mayor. */
async function siguienteFolio(env: Env, tabla: 'oportunidades' | 'proyectos', prefijo: string): Promise<string> {
  const row = await env.DB.prepare(
    `SELECT max(CAST(substr(folio, ?1) AS INTEGER)) AS n FROM ${tabla} WHERE folio LIKE ?2`,
  ).bind(prefijo.length + 2, `${prefijo}-%`).first<{ n: number | null }>();
  return `${prefijo}-${String((row?.n ?? 0) + 1).padStart(4, '0')}`;
}

async function guardarLineas(env: Env, oppId: number, lineas: Linea[]): Promise<void> {
  const stmts = [env.DB.prepare(`DELETE FROM lineas WHERE oportunidad_id = ?`).bind(oppId)];
  lineas.forEach((l, i) => {
    stmts.push(env.DB.prepare(
      `INSERT INTO lineas (oportunidad_id, orden, periodicidad, concepto, descripcion, cantidad, precio) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    ).bind(oppId, i, oneOf(l.periodicidad, PERIODICIDADES, 'mensual'), str(l.concepto, 200) ?? 'Concepto',
      str(l.descripcion, 2000), num(l.cantidad, 1), num(l.precio, 0)));
  });
  await env.DB.batch(stmts);
}

/** Una oportunidad ganada se vuelve proyecto (si no lo era ya). Renta = líneas mensuales sin IVA. */
export async function ganar(env: Env, oppId: number): Promise<number | null> {
  const o = await env.DB.prepare(`SELECT id, cliente_id, nombre FROM oportunidades WHERE id = ?`).bind(oppId).first<{ id: number; cliente_id: number; nombre: string }>();
  if (!o) return null;
  const ya = await env.DB.prepare(`SELECT id FROM proyectos WHERE oportunidad_id = ?`).bind(oppId).first<{ id: number }>();
  if (ya) return ya.id;
  const renta = totales(await lineasDe(env, oppId), 0).mensual.subtotal;
  const folio = await siguienteFolio(env, 'proyectos', 'PRY');
  const res = await env.DB.prepare(
    `INSERT INTO proyectos (folio, cliente_id, oportunidad_id, nombre, renta_mensual) VALUES (?1, ?2, ?3, ?4, ?5)`,
  ).bind(folio, o.cliente_id, o.id, o.nombre, renta).run();
  return Number(res.meta.last_row_id);
}

// Actualiza solo las columnas presentes en el body, de una lista permitida.
async function patch(env: Env, tabla: string, id: number, cols: Record<string, unknown>): Promise<boolean> {
  const keys = Object.keys(cols);
  if (!keys.length) return true;
  const set = keys.map((k, i) => `${k} = ?${i + 1}`).join(', ');
  const res = await env.DB.prepare(`UPDATE ${tabla} SET ${set}, updated_at = datetime('now') WHERE id = ?${keys.length + 1}`)
    .bind(...keys.map(k => cols[k]), id).run();
  return res.meta.changes > 0;
}

// ── rutas ──────────────────────────────────────────────────────────────────────

export async function apiRoutes(req: Request, env: Env, url: URL, me: User): Promise<Response> {
  const path = url.pathname.replace(/\/$/, '');
  const m = (re: RegExp) => path.match(re);
  const GET = req.method === 'GET', POST = req.method === 'POST';
  let x: RegExpMatchArray | null;

  if (GET && path === '/api/me') {
    return json({ user: me, ajustes: await ajustes(env), etapas: ETAPAS, estados_proyecto: ESTADOS_PROYECTO });
  }

  // ── board / oportunidades ──
  if (GET && path === '/api/board') {
    const rows = await env.DB.prepare(
      `SELECT o.id, o.folio, o.nombre, o.etapa, o.fecha, o.iva, o.token, o.updated_at, o.cliente_id, c.nombre AS cliente,
              (SELECT count(*) FROM vistas v WHERE v.oportunidad_id = o.id) AS vistas
         FROM oportunidades o JOIN clientes c ON c.id = o.cliente_id ORDER BY o.updated_at DESC LIMIT 500`,
    ).all<{ id: number; iva: number }>();
    const out = await Promise.all(rows.results.map(async o => ({ ...o, totales: totales(await lineasDe(env, o.id), o.iva) })));
    return json({ oportunidades: out });
  }

  if (POST && path === '/api/oportunidades') {
    const b = await body<{ cliente_id?: number; cliente_nombre?: string; nombre?: string }>(req);
    if (!b) return json({ error: 'JSON requerido' }, 400);
    let clienteId = num(b.cliente_id, 0);
    if (!clienteId) {
      const nombre = str(b.cliente_nombre, 200);
      if (!nombre) return json({ error: 'elige un cliente o escribe uno nuevo' }, 400);
      const r = await env.DB.prepare(`INSERT INTO clientes (nombre) VALUES (?)`).bind(nombre).run();
      clienteId = Number(r.meta.last_row_id);
    }
    const cli = await env.DB.prepare(`SELECT id, nombre FROM clientes WHERE id = ?`).bind(clienteId).first<{ id: number; nombre: string }>();
    if (!cli) return json({ error: 'cliente no existe' }, 404);
    const contacto = await env.DB.prepare(`SELECT id FROM contactos WHERE cliente_id = ? ORDER BY id LIMIT 1`).bind(cli.id).first<{ id: number }>();
    const a = await ajustes(env);
    const folio = await siguienteFolio(env, 'oportunidades', 'OPP');
    const res = await env.DB.prepare(
      `INSERT INTO oportunidades (folio, cliente_id, contacto_id, nombre, fecha, vigencia_dias, iva, alcance, condiciones, token)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
    ).bind(folio, cli.id, contacto?.id ?? null, str(b.nombre, 200) ?? 'Portal a la medida', hoy(), num(a.vigencia_dias, 15), num(a.iva, 16),
      a.alcance ?? '', a.condiciones ?? '', randomToken()).run();
    const id = Number(res.meta.last_row_id);
    // Arranca con construcción + renta: el primer concepto activo de cada periodicidad.
    const cat = await env.DB.prepare(`SELECT * FROM catalogo WHERE activo = 1 ORDER BY orden, id`).all<Linea>();
    const base: Linea[] = [];
    const u = cat.results.find(c => c.periodicidad === 'unico'), mm = cat.results.find(c => c.periodicidad === 'mensual');
    if (u) base.push({ ...u, orden: 0, cantidad: 1 });
    if (mm) base.push({ ...mm, orden: 1, cantidad: 1 });
    if (base.length) await guardarLineas(env, id, base);
    return json({ ok: true, id, folio });
  }

  if (GET && (x = m(/^\/api\/oportunidades\/(\d+)$/))) {
    const id = Number(x[1]);
    const o = await env.DB.prepare(
      `SELECT o.*, c.nombre AS cliente, k.nombre AS contacto, k.telefono AS contacto_telefono
         FROM oportunidades o JOIN clientes c ON c.id = o.cliente_id LEFT JOIN contactos k ON k.id = o.contacto_id WHERE o.id = ?`,
    ).bind(id).first<{ iva: number; cliente_id: number }>();
    if (!o) return json({ error: 'no existe' }, 404);
    const [lineas, vistas, contactos, cat, pry] = await Promise.all([
      lineasDe(env, id),
      env.DB.prepare(`SELECT created_at FROM vistas WHERE oportunidad_id = ? ORDER BY created_at DESC LIMIT 20`).bind(id).all(),
      env.DB.prepare(`SELECT id, nombre, puesto, telefono, correo FROM contactos WHERE cliente_id = ? ORDER BY id`).bind(o.cliente_id).all(),
      env.DB.prepare(`SELECT * FROM catalogo WHERE activo = 1 ORDER BY orden, id`).all(),
      env.DB.prepare(`SELECT id, folio FROM proyectos WHERE oportunidad_id = ?`).bind(id).first(),
    ]);
    return json({ oportunidad: o, lineas, totales: totales(lineas, o.iva), vistas: vistas.results, contactos: contactos.results, catalogo: cat.results, proyecto: pry });
  }

  if (POST && (x = m(/^\/api\/oportunidades\/(\d+)$/))) {
    const id = Number(x[1]);
    const b = await body<Record<string, unknown> & { lineas?: Linea[] }>(req);
    if (!b) return json({ error: 'JSON requerido' }, 400);
    const cols: Record<string, unknown> = {};
    if ('nombre' in b) cols.nombre = str(b.nombre, 200) ?? 'Oportunidad';
    if ('contacto_id' in b) cols.contacto_id = num(b.contacto_id, 0) || null;
    if ('fecha' in b) cols.fecha = str(b.fecha, 10) ?? hoy();
    if ('vigencia_dias' in b) cols.vigencia_dias = Math.max(1, Math.round(num(b.vigencia_dias, 15)));
    if ('iva' in b) cols.iva = Math.max(0, num(b.iva, 16));
    if ('alcance' in b) cols.alcance = str(b.alcance, 8000) ?? '';
    if ('condiciones' in b) cols.condiciones = str(b.condiciones, 8000) ?? '';
    if ('notas' in b) cols.notas = str(b.notas, 5000);
    if (!(await patch(env, 'oportunidades', id, cols))) return json({ error: 'no existe' }, 404);
    if (Array.isArray(b.lineas)) await guardarLineas(env, id, b.lineas.slice(0, 100));
    const o = await env.DB.prepare(`SELECT iva FROM oportunidades WHERE id = ?`).bind(id).first<{ iva: number }>();
    const lineas = await lineasDe(env, id);
    return json({ ok: true, lineas, totales: totales(lineas, o?.iva ?? 16) });
  }

  if (POST && (x = m(/^\/api\/oportunidades\/(\d+)\/etapa$/))) {
    const id = Number(x[1]);
    const b = await body<{ etapa: string }>(req);
    const etapa = oneOf(b?.etapa, ETAPAS, 'nueva');
    if (!(await patch(env, 'oportunidades', id, { etapa }))) return json({ error: 'no existe' }, 404);
    const proyecto_id = etapa === 'ganada' ? await ganar(env, id) : null;
    return json({ ok: true, proyecto_id });
  }

  if (POST && (x = m(/^\/api\/oportunidades\/(\d+)\/duplicar$/))) {
    const id = Number(x[1]);
    const o = await env.DB.prepare(`SELECT * FROM oportunidades WHERE id = ?`).bind(id).first<Record<string, unknown>>();
    if (!o) return json({ error: 'no existe' }, 404);
    const folio = await siguienteFolio(env, 'oportunidades', 'OPP');
    const res = await env.DB.prepare(
      `INSERT INTO oportunidades (folio, cliente_id, contacto_id, nombre, fecha, vigencia_dias, moneda, iva, alcance, condiciones, notas, token)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`,
    ).bind(folio, o.cliente_id, o.contacto_id, o.nombre, hoy(), o.vigencia_dias, o.moneda, o.iva, o.alcance, o.condiciones, o.notas, randomToken()).run();
    const nid = Number(res.meta.last_row_id);
    await guardarLineas(env, nid, await lineasDe(env, id));
    return json({ ok: true, id: nid, folio });
  }

  if (POST && (x = m(/^\/api\/oportunidades\/(\d+)\/eliminar$/))) {
    await env.DB.prepare(`DELETE FROM oportunidades WHERE id = ?`).bind(Number(x[1])).run();
    return json({ ok: true });
  }

  // ── proyectos ──
  if (GET && path === '/api/proyectos') {
    const rows = await env.DB.prepare(
      `SELECT p.*, c.nombre AS cliente, o.folio AS oportunidad_folio
         FROM proyectos p JOIN clientes c ON c.id = p.cliente_id LEFT JOIN oportunidades o ON o.id = p.oportunidad_id
        ORDER BY p.updated_at DESC LIMIT 500`,
    ).all();
    return json({ proyectos: rows.results });
  }

  if (POST && (x = m(/^\/api\/proyectos\/(\d+)$/))) {
    const b = await body<Record<string, unknown>>(req);
    if (!b) return json({ error: 'JSON requerido' }, 400);
    const cols: Record<string, unknown> = {};
    if ('nombre' in b) cols.nombre = str(b.nombre, 200) ?? 'Proyecto';
    if ('estado' in b) cols.estado = oneOf(b.estado, ESTADOS_PROYECTO, 'entrevistas');
    if ('inicio' in b) cols.inicio = str(b.inicio, 10);
    if ('renta_mensual' in b) cols.renta_mensual = Math.max(0, num(b.renta_mensual, 0));
    if ('notas' in b) cols.notas = str(b.notas, 5000);
    if (!(await patch(env, 'proyectos', Number(x[1]), cols))) return json({ error: 'no existe' }, 404);
    return json({ ok: true });
  }

  if (POST && (x = m(/^\/api\/proyectos\/(\d+)\/eliminar$/))) {
    await env.DB.prepare(`DELETE FROM proyectos WHERE id = ?`).bind(Number(x[1])).run();
    return json({ ok: true });
  }

  // ── clientes ──
  if (GET && path === '/api/clientes') {
    const q = (url.searchParams.get('q') ?? '').trim();
    const rows = await env.DB.prepare(
      `SELECT c.*,
              (SELECT count(*) FROM oportunidades o WHERE o.cliente_id = c.id) AS n_oportunidades,
              (SELECT count(*) FROM proyectos p WHERE p.cliente_id = c.id) AS n_proyectos,
              (SELECT k.nombre FROM contactos k WHERE k.cliente_id = c.id ORDER BY k.id LIMIT 1) AS contacto
         FROM clientes c
        WHERE ?1 = '' OR c.nombre LIKE ?2 OR EXISTS (SELECT 1 FROM contactos k WHERE k.cliente_id = c.id AND (k.nombre LIKE ?2 OR k.telefono LIKE ?2 OR k.correo LIKE ?2))
        ORDER BY c.updated_at DESC LIMIT 500`,
    ).bind(q, `%${q}%`).all();
    return json({ clientes: rows.results });
  }

  if (POST && path === '/api/clientes') {
    const b = await body<Record<string, unknown>>(req);
    if (!b) return json({ error: 'JSON requerido' }, 400);
    const nombre = str(b.nombre, 200);
    if (!nombre) return json({ error: 'el nombre es obligatorio' }, 400);
    const res = await env.DB.prepare(`INSERT INTO clientes (nombre, giro, ciudad, rfc, notas) VALUES (?1, ?2, ?3, ?4, ?5)`)
      .bind(nombre, str(b.giro, 200), str(b.ciudad, 100), str(b.rfc, 20), str(b.notas, 5000)).run();
    const id = Number(res.meta.last_row_id);
    // Contacto inicial opcional, en el mismo alta.
    if (str(b.contacto_nombre, 200)) {
      await env.DB.prepare(`INSERT INTO contactos (cliente_id, nombre, puesto, telefono, correo) VALUES (?1, ?2, ?3, ?4, ?5)`)
        .bind(id, str(b.contacto_nombre, 200), str(b.contacto_puesto, 100), str(b.contacto_telefono, 40), str(b.contacto_correo, 200)).run();
    }
    return json({ ok: true, id });
  }

  if (GET && (x = m(/^\/api\/clientes\/(\d+)$/))) {
    const id = Number(x[1]);
    const c = await env.DB.prepare(`SELECT * FROM clientes WHERE id = ?`).bind(id).first();
    if (!c) return json({ error: 'no existe' }, 404);
    const [contactos, opps, pry] = await Promise.all([
      env.DB.prepare(`SELECT * FROM contactos WHERE cliente_id = ? ORDER BY id`).bind(id).all(),
      env.DB.prepare(`SELECT id, folio, nombre, etapa, fecha, iva FROM oportunidades WHERE cliente_id = ? ORDER BY created_at DESC`).bind(id).all<{ id: number; iva: number }>(),
      env.DB.prepare(`SELECT id, folio, nombre, estado, renta_mensual FROM proyectos WHERE cliente_id = ? ORDER BY created_at DESC`).bind(id).all(),
    ]);
    const oportunidades = await Promise.all(opps.results.map(async o => ({ ...o, totales: totales(await lineasDe(env, o.id), o.iva) })));
    return json({ cliente: c, contactos: contactos.results, oportunidades, proyectos: pry.results });
  }

  if (POST && (x = m(/^\/api\/clientes\/(\d+)$/))) {
    const b = await body<Record<string, unknown>>(req);
    if (!b) return json({ error: 'JSON requerido' }, 400);
    const cols: Record<string, unknown> = {};
    if ('nombre' in b) { const n = str(b.nombre, 200); if (!n) return json({ error: 'el nombre es obligatorio' }, 400); cols.nombre = n; }
    for (const k of ['giro', 'ciudad', 'rfc'] as const) if (k in b) cols[k] = str(b[k], 200);
    if ('notas' in b) cols.notas = str(b.notas, 5000);
    if (!(await patch(env, 'clientes', Number(x[1]), cols))) return json({ error: 'no existe' }, 404);
    return json({ ok: true });
  }

  if (POST && (x = m(/^\/api\/clientes\/(\d+)\/eliminar$/))) {
    await env.DB.prepare(`DELETE FROM clientes WHERE id = ?`).bind(Number(x[1])).run();
    return json({ ok: true });
  }

  // ── contactos ──
  if (POST && path === '/api/contactos') {
    const b = await body<Record<string, unknown>>(req);
    if (!b) return json({ error: 'JSON requerido' }, 400);
    const nombre = str(b.nombre, 200);
    if (!nombre || !num(b.cliente_id)) return json({ error: 'nombre y cliente requeridos' }, 400);
    const res = await env.DB.prepare(`INSERT INTO contactos (cliente_id, nombre, puesto, telefono, correo) VALUES (?1, ?2, ?3, ?4, ?5)`)
      .bind(num(b.cliente_id), nombre, str(b.puesto, 100), str(b.telefono, 40), str(b.correo, 200)).run();
    return json({ ok: true, id: Number(res.meta.last_row_id) });
  }

  if (POST && (x = m(/^\/api\/contactos\/(\d+)$/))) {
    const b = await body<Record<string, unknown>>(req);
    if (!b) return json({ error: 'JSON requerido' }, 400);
    const nombre = str(b.nombre, 200);
    if (!nombre) return json({ error: 'el nombre es obligatorio' }, 400);
    const res = await env.DB.prepare(`UPDATE contactos SET nombre = ?1, puesto = ?2, telefono = ?3, correo = ?4 WHERE id = ?5`)
      .bind(nombre, str(b.puesto, 100), str(b.telefono, 40), str(b.correo, 200), Number(x[1])).run();
    if (!res.meta.changes) return json({ error: 'no existe' }, 404);
    return json({ ok: true });
  }

  if (POST && (x = m(/^\/api\/contactos\/(\d+)\/eliminar$/))) {
    await env.DB.prepare(`DELETE FROM contactos WHERE id = ?`).bind(Number(x[1])).run();
    return json({ ok: true });
  }

  // ── catálogo ──
  if (GET && path === '/api/catalogo') {
    const cat = await env.DB.prepare(`SELECT * FROM catalogo ORDER BY orden, id`).all();
    return json({ catalogo: cat.results });
  }

  if (POST && path === '/api/catalogo') {
    const b = await body<Record<string, unknown>>(req);
    if (!b) return json({ error: 'JSON requerido' }, 400);
    const concepto = str(b.concepto, 200);
    if (!concepto) return json({ error: 'concepto requerido' }, 400);
    const vals = [concepto, str(b.descripcion, 2000), oneOf(b.periodicidad, PERIODICIDADES, 'mensual'), num(b.precio, 0), Math.round(num(b.orden, 0)), b.activo === false || b.activo === 0 ? 0 : 1];
    if (b.id) {
      await env.DB.prepare(`UPDATE catalogo SET concepto=?1, descripcion=?2, periodicidad=?3, precio=?4, orden=?5, activo=?6 WHERE id=?7`).bind(...vals, num(b.id)).run();
      return json({ ok: true, id: num(b.id) });
    }
    const res = await env.DB.prepare(`INSERT INTO catalogo (concepto, descripcion, periodicidad, precio, orden, activo) VALUES (?1,?2,?3,?4,?5,?6)`).bind(...vals).run();
    return json({ ok: true, id: Number(res.meta.last_row_id) });
  }

  if (POST && (x = m(/^\/api\/catalogo\/(\d+)\/eliminar$/))) {
    await env.DB.prepare(`DELETE FROM catalogo WHERE id = ?`).bind(Number(x[1])).run();
    return json({ ok: true });
  }

  // ── ajustes y contraseña ──
  if (POST && path === '/api/ajustes') {
    const b = await body<Record<string, unknown>>(req);
    if (!b) return json({ error: 'JSON requerido' }, 400);
    const permitidas = ['razon_social', 'rfc', 'domicilio', 'correo', 'telefono', 'web', 'vigencia_dias', 'iva', 'alcance', 'condiciones'];
    const stmts = permitidas.filter(k => k in b).map(k =>
      env.DB.prepare(`INSERT INTO ajustes (clave, valor) VALUES (?1, ?2) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor, updated_at = datetime('now')`)
        .bind(k, String(b[k] ?? '').slice(0, 8000)));
    if (stmts.length) await env.DB.batch(stmts);
    return json({ ok: true, ajustes: await ajustes(env) });
  }

  if (POST && path === '/api/password') {
    const b = await body<{ actual: string; nueva: string }>(req);
    if (!b) return json({ error: 'JSON requerido' }, 400);
    const row = await env.DB.prepare(`SELECT password_hash FROM users WHERE id = ?`).bind(me.id).first<{ password_hash: string }>();
    if (!row || !(await verifyPassword(String(b.actual ?? ''), row.password_hash))) return json({ error: 'contraseña actual incorrecta' }, 401);
    const bad = passwordProblem(b.nueva);
    if (bad) return json({ error: bad }, 400);
    await env.DB.prepare(`UPDATE users SET password_hash = ?1 WHERE id = ?2`).bind(await hashPassword(b.nueva), me.id).run();
    return json({ ok: true });
  }

  return json({ error: 'not found' }, 404);
}
