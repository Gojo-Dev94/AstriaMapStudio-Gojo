import 'dotenv/config';
import Fastify, { type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import mysql, { type PoolConnection, type RowDataPacket } from 'mysql2/promise';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importLegacyRow, type LegacyRow } from '../src/legacy.ts';
import { cellCount, cloneMap, createMap, gfxUsed, validateMap, type MapDocument } from '../src/domain.ts';
import { scanAssets } from './assets.ts';
import { decodeAstriaSwf } from './swf.ts';
import { MAP_COLUMNS, mapColumnList, mapPlaceholders, mapProjection, mapUpdateList, parseTeleport, teleportArgs } from './atlanta.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const dbUrl = process.env.DATABASE_URL;
const secret = process.env.JWT_SECRET;
if (!dbUrl || !secret || secret.length < 32) throw new Error('Set DATABASE_URL and JWT_SECRET (at least 32 characters)');
const pool = mysql.createPool(dbUrl);
const app = Fastify({ logger: true, bodyLimit: 10 * 1024 * 1024 });
await app.register(cors, { origin: /^http:\/\/(localhost|127\.0\.0\.1):5173$/ });
await app.register(jwt, { secret });
await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });
const assetRoot = resolve(root, process.env.ASSET_ROOT ?? (existsSync(resolve(root, 'assets/Images')) ? 'assets/Images' : '../../Images'));
const metadataRoot = resolve(root, process.env.METADATA_ROOT ?? (existsSync(resolve(root, 'assets/XML')) ? 'assets/XML' : '../bin/AME Gojo/XML'));
const assetBaseUrl = process.env.ASSET_BASE_URL ?? '/tile-assets';
let assets = await scanAssets(assetRoot, metadataRoot, assetBaseUrl);

type User = { sub: string; role: 'viewer' | 'editor' | 'admin' };
const auth = async (req: FastifyRequest): Promise<User> => {
  await req.jwtVerify();
  return req.user as User;
};
const edit = (user: User) => { if (user.role === 'viewer') throw Object.assign(new Error('Editor permission required'), { statusCode: 403 }); };
const fail = (statusCode: number, message: string): never => { throw Object.assign(new Error(message), { statusCode }); };
const idOf = (params: unknown) => { const id = Number((params as { id: string }).id); if (!Number.isSafeInteger(id) || id < 1 || id > 32767) throw Object.assign(new Error('Map ID must be 1–32767 for this emulator'), { statusCode: 400 }); return id; };
const escapeSql = (value: string) => `'${value.replaceAll('\\', '\\\\').replaceAll("'", "''")}'`;
const audit = async (conn: PoolConnection, user: User, action: string, mapId: number, details: object = {}) => {
  await conn.execute('INSERT INTO editor_audit(actor, action, map_id, details_json) VALUES (?, ?, ?, ?)', [user.sub, action, mapId, JSON.stringify(details)]);
};
const png = (url?: string): Buffer | null => {
  if (!url) return null;
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(url) || url.length > 4_000_000) throw Object.assign(new Error('Invalid PNG thumbnail'), { statusCode: 400 });
  return Buffer.from(url.slice('data:image/png;base64,'.length), 'base64');
};
async function writeProjection(conn: PoolConnection, map: MapDocument, insert = false) {
  if (insert) await conn.execute(`INSERT INTO mapas (${mapColumnList}) VALUES (${mapPlaceholders})`, mapProjection(map));
  else await conn.execute(`UPDATE mapas SET ${mapUpdateList} WHERE id=?`, [...mapProjection(map).slice(1), map.id]);
}
type DbSnapshot = { row: RowDataPacket; triggers: RowDataPacket[]; fightActions: RowDataPacket[]; fixedGroups: RowDataPacket[] };
async function readSnapshot(conn: PoolConnection, id: number): Promise<DbSnapshot | null> {
  const [maps] = await conn.execute<RowDataPacket[]>('SELECT * FROM mapas WHERE id=?', [id]);
  if (!maps.length) return null;
  const [triggers] = await conn.execute<RowDataPacket[]>('SELECT * FROM celdas_accion WHERE mapa=? ORDER BY celda, accion', [id]);
  const [fightActions] = await conn.execute<RowDataPacket[]>('SELECT * FROM accion_pelea WHERE mapa=? ORDER BY tipoPelea, accion, condicion', [id]);
  const [fixedGroups] = await conn.execute<RowDataPacket[]>('SELECT * FROM mobs_fix WHERE mapa=? ORDER BY celda', [String(id)]);
  return { row: maps[0], triggers, fightActions, fixedGroups };
}
const sourceHash = (snapshot: DbSnapshot) => createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
async function hydrate(conn: PoolConnection, snapshot: DbSnapshot): Promise<MapDocument> {
  const [geo] = await conn.execute<RowDataPacket[]>('SELECT s.area, a.superarea FROM subareas s LEFT JOIN areas a ON a.id=s.area WHERE s.id=?', [snapshot.row.subArea]);
  const map = importLegacyRow({ ...snapshot.row, area: geo[0]?.area ?? 0, superarea: geo[0]?.superarea ?? 0 } as LegacyRow);
  for (const row of snapshot.triggers) {
    const target = Number(row.accion) === 0 ? parseTeleport(row.args) : null;
    if (target && map.cells[Number(row.celda)]) map.cells[Number(row.celda)].trigger = target;
  }
  const endActions = snapshot.fightActions.filter(row => Number(row.tipoPelea) === 4 && Number(row.accion) === 0);
  if (endActions.length === 1) {
    const target = parseTeleport(endActions[0].args);
    if (target) { map.nextRoom = target.mapId; map.nextCell = target.cellId; }
  }
  if (snapshot.fixedGroups.length === 1) {
    map.combat.fixedCell = Number(snapshot.fixedGroups[0].celda);
    map.combat.fixedMobs = snapshot.fixedGroups[0].mobs;
  }
  map.sourceHash = sourceHash(snapshot);
  return map;
}
async function applyRelatedChanges(conn: PoolConnection, before: MapDocument, next: MapDocument, snapshot: DbSnapshot) {
  for (const cell of next.cells) {
    const previous = before.cells[cell.id]?.trigger;
    const current = cell.trigger;
    if (JSON.stringify(previous ?? null) === JSON.stringify(current ?? null)) continue;
    const existing = snapshot.triggers.find(row => Number(row.celda) === cell.id && Number(row.accion) === 0);
    if (existing && (!previous || !parseTeleport(existing.args))) fail(409, `Cell ${cell.id} has an unsupported existing teleport action`);
    if (existing && current) await conn.execute('UPDATE celdas_accion SET args=? WHERE mapa=? AND celda=? AND accion=0', [teleportArgs(current), next.id, cell.id]);
    else if (existing) await conn.execute('DELETE FROM celdas_accion WHERE mapa=? AND celda=? AND accion=0', [next.id, cell.id]);
    else if (current) await conn.execute('INSERT INTO celdas_accion(mapa,celda,accion,args,condicion) VALUES (?,?,0,?,\'\')', [next.id, cell.id, teleportArgs(current)]);
  }
  const oldEnd = before.nextRoom === null || before.nextCell === null ? null : { mapId: before.nextRoom, cellId: before.nextCell };
  const newEnd = next.nextRoom === null || next.nextCell === null ? null : { mapId: next.nextRoom, cellId: next.nextCell };
  if (JSON.stringify(oldEnd) !== JSON.stringify(newEnd)) {
    const rows = snapshot.fightActions.filter(row => Number(row.tipoPelea) === 4 && Number(row.accion) === 0);
    if (rows.length > 1 || (rows.length && (!oldEnd || !parseTeleport(rows[0].args)))) fail(409, 'This map has multiple or unsupported end fight teleports');
    if (rows.length && newEnd) await conn.execute('UPDATE accion_pelea SET args=? WHERE mapa=? AND tipoPelea=4 AND accion=0 AND condicion=?', [teleportArgs(newEnd), next.id, rows[0].condicion]);
    else if (rows.length) await conn.execute('DELETE FROM accion_pelea WHERE mapa=? AND tipoPelea=4 AND accion=0 AND condicion=?', [next.id, rows[0].condicion]);
    else if (newEnd) await conn.execute('INSERT INTO accion_pelea(mapa,tipoPelea,accion,args,condicion,descripcion) VALUES (?,4,0,?,\'\',\'\')', [next.id, teleportArgs(newEnd)]);
  }
  if (before.combat.fixedCell !== next.combat.fixedCell || before.combat.fixedMobs !== next.combat.fixedMobs) {
    if (snapshot.fixedGroups.length > 1) fail(409, 'This map has multiple fixed monster groups; edit them in the emulator database');
    const existing = snapshot.fixedGroups[0];
    const enabled = next.combat.fixedCell !== null && next.combat.fixedMobs.length > 0;
    if (existing && enabled) await conn.execute('UPDATE mobs_fix SET celda=?, mobs=? WHERE mapa=? AND celda=?', [next.combat.fixedCell, next.combat.fixedMobs, String(next.id), existing.celda]);
    else if (existing) await conn.execute('DELETE FROM mobs_fix WHERE mapa=? AND celda=?', [String(next.id), existing.celda]);
    else if (enabled) await conn.execute('INSERT INTO mobs_fix(mapa,celda,mobs,tipo,condicion,segundosRespawn,descripcion) VALUES (?,?,?,-1,\'\',0,\'\')', [String(next.id), next.combat.fixedCell, next.combat.fixedMobs]);
  }
}
function assertRelatedChangeSafety(before: MapDocument, next: MapDocument, snapshot: DbSnapshot) {
  for (const cell of next.cells) {
    if (JSON.stringify(before.cells[cell.id]?.trigger ?? null) === JSON.stringify(cell.trigger ?? null)) continue;
    const existing = snapshot.triggers.find(row => Number(row.celda) === cell.id && Number(row.accion) === 0);
    if (existing && (!before.cells[cell.id]?.trigger || !parseTeleport(existing.args))) fail(409, `Cell ${cell.id} has an unsupported existing teleport action`);
  }
  const oldEnd = before.nextRoom === null || before.nextCell === null ? null : { mapId: before.nextRoom, cellId: before.nextCell };
  const newEnd = next.nextRoom === null || next.nextCell === null ? null : { mapId: next.nextRoom, cellId: next.nextCell };
  if (JSON.stringify(oldEnd) !== JSON.stringify(newEnd)) {
    const rows = snapshot.fightActions.filter(row => Number(row.tipoPelea) === 4 && Number(row.accion) === 0);
    if (rows.length > 1 || (rows.length && (!oldEnd || !parseTeleport(rows[0].args)))) fail(409, 'This map has multiple or unsupported end fight teleports');
  }
  if ((before.combat.fixedCell !== next.combat.fixedCell || before.combat.fixedMobs !== next.combat.fixedMobs) && snapshot.fixedGroups.length > 1) fail(409, 'This map has multiple fixed monster groups');
}
async function assertLock(conn: PoolConnection, id: number, owner: string) {
  const [rows] = await conn.execute<RowDataPacket[]>('SELECT owner, (expires_at > NOW(3)) AS valid FROM editor_locks WHERE map_id=? FOR UPDATE', [id]);
  if (!rows.length || rows[0].owner !== owner || !rows[0].valid) throw Object.assign(new Error('Editing lock expired or owned by another user'), { statusCode: 423 });
}
async function validateTargets(conn: PoolConnection, map: MapDocument, before?: MapDocument): Promise<string[]> {
  const targets = map.cells.flatMap(cell => cell.trigger && JSON.stringify(cell.trigger) !== JSON.stringify(before?.cells[cell.id]?.trigger ?? null) ? [cell.trigger] : []);
  if (map.nextRoom !== null && map.nextCell !== null && (map.nextRoom !== before?.nextRoom || map.nextCell !== before?.nextCell)) targets.push({ mapId: map.nextRoom, cellId: map.nextCell });
  if (targets.length > 1000) return ['Too many map links'];
  if (!targets.length) return [];
  const ids = [...new Set(targets.map(target => target.mapId))];
  const [rows] = await conn.query<RowDataPacket[]>(`SELECT id, ancho, alto FROM mapas WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
  const dimensions = new Map(rows.map(row => [Number(row.id), [Number(row.ancho), Number(row.alto)]]));
  return targets.flatMap(target => {
    const size = dimensions.get(target.mapId);
    return !size ? [`Target map ${target.mapId} does not exist`] : target.cellId >= cellCount(size[0], size[1]) ? [`Target cell ${target.mapId}:${target.cellId} is out of range`] : [];
  });
}
function newHash(password: string, salt: string) { return scryptSync(password, Buffer.from(salt, 'hex'), 64).toString('hex'); }
async function bootstrap() {
  const required: Record<string, string[]> = {
    mapas: [...MAP_COLUMNS],
    celdas_accion: ['mapa', 'celda', 'accion', 'args', 'condicion'],
    accion_pelea: ['mapa', 'tipoPelea', 'accion', 'args', 'condicion', 'descripcion'],
    mobs_fix: ['mapa', 'celda', 'mobs', 'tipo', 'condicion', 'segundosRespawn', 'descripcion'],
    subareas: ['id', 'area'], areas: ['id', 'superarea'], mobs_modelo: ['id', 'nombre'],
  };
  const [columns] = await pool.query<RowDataPacket[]>('SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()');
  for (const [table, names] of Object.entries(required)) {
    const found = new Set(columns.filter(row => row.tableName === table).map(row => String(row.columnName)));
    const missing = names.filter(name => !found.has(name));
    if (missing.length) throw new Error(`Incompatible emulator schema: ${table} missing ${missing.join(', ')}`);
  }
  const schema = await readFile(resolve(here, 'schema.sql'), 'utf8');
  for (const statement of schema.split(';').map(s => s.trim()).filter(Boolean)) await pool.query(statement);
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  if (username && password) {
    const [rows] = await pool.execute<RowDataPacket[]>('SELECT id FROM editor_users WHERE username=?', [username]);
    if (!rows.length) {
      const salt = randomBytes(16).toString('hex');
      await pool.execute('INSERT INTO editor_users(username, password_salt, password_hash, role) VALUES (?, ?, ?, ?)', [username, salt, newHash(password, salt), 'admin']);
    }
  }
}
await bootstrap();
app.setErrorHandler((error, _req, reply) => {
  const issue = error as Error & { statusCode?: number; details?: string[] };
  const status = issue.statusCode && issue.statusCode >= 400 && issue.statusCode < 500 ? issue.statusCode : 500;
  if (status === 500) app.log.error(error);
  reply.status(status).send({ error: status === 500 ? 'Internal server error' : issue.message, ...(issue.details ? { details: issue.details } : {}) });
});
app.post('/api/auth/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
  const { username, password } = (req.body ?? {}) as { username?: string; password?: string };
  if (typeof username !== 'string' || !username || username.length > 100 || typeof password !== 'string' || !password || password.length > 256) return reply.code(400).send({ error: 'Invalid credentials' });
  const [rows] = await pool.execute<RowDataPacket[]>('SELECT username, password_salt, password_hash, role FROM editor_users WHERE username=?', [username]);
  const row = rows[0];
  const check = row ? newHash(password, row.password_salt) : newHash(password, '00000000000000000000000000000000');
  if (!row || !timingSafeEqual(Buffer.from(check, 'hex'), Buffer.from(row.password_hash, 'hex'))) return reply.code(401).send({ error: 'Invalid credentials' });
  const user: User = { sub: row.username, role: row.role };
  return { token: app.jwt.sign(user, { expiresIn: '8h' }), user };
});
app.get('/api/auth/me', async req => auth(req));
app.get('/api/maps', async req => {
  await auth(req);
  const [rows] = await pool.query<RowDataPacket[]>('SELECT map_id AS id, version, updated_at AS updatedAt, JSON_UNQUOTE(JSON_EXTRACT(document_json, "$.dateMap")) AS dateMap FROM editor_map_documents ORDER BY updated_at DESC LIMIT 1000');
  return rows.map(row => ({ ...row, thumbnailUrl: `/api/maps/${row.id}/thumbnail` }));
});
app.post('/api/maps', async (req, reply) => {
  const user = await auth(req); edit(user);
  const { id, width = 15, height = 17, subArea } = (req.body ?? {}) as { id?: number; width?: number; height?: number; subArea?: number };
  if (!Number.isSafeInteger(id) || Number(id) < 1 || Number(id) > 32767) return reply.code(400).send({ error: 'Map ID must be 1–32767' });
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2 || width > 100 || height > 100) return reply.code(400).send({ error: 'Invalid map size' });
  if (!Number.isInteger(subArea)) return reply.code(400).send({ error: 'Select a valid emulator subarea' });
  const [geo] = await pool.execute<RowDataPacket[]>('SELECT s.area, a.superarea FROM subareas s JOIN areas a ON a.id=s.area WHERE s.id=?', [subArea!]);
  if (!geo.length) return reply.code(400).send({ error: 'Subarea does not exist in the emulator' });
  const map = createMap(Number(id), Number(width), Number(height), user.sub);
  map.geoposition.subArea = subArea!; map.geoposition.area = Number(geo[0].area); map.geoposition.superArea = Number(geo[0].superarea);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [existing] = await conn.execute<RowDataPacket[]>('SELECT id FROM mapas WHERE id=?', [map.id]);
    if (existing.length) fail(409, 'Map ID already exists; use legacy import');
    map.version = 1;
    await writeProjection(conn, map, true);
    const snapshot = await readSnapshot(conn, map.id);
    if (!snapshot) fail(500, 'Created map cannot be read back');
    map.sourceHash = sourceHash(snapshot!);
    await conn.execute('INSERT INTO editor_map_documents(map_id, document_json, version, author) VALUES (?, ?, 1, ?)', [map.id, JSON.stringify(map), user.sub]);
    await conn.execute('INSERT INTO editor_map_versions(map_id, version, document_json, author) VALUES (?, 1, ?, ?)', [map.id, JSON.stringify(map), user.sub]);
    await conn.execute('INSERT INTO editor_locks(map_id, owner, expires_at) VALUES (?, ?, DATE_ADD(NOW(3), INTERVAL 120 SECOND))', [map.id, user.sub]);
    await audit(conn, user, 'map.create', map.id);
    await conn.commit();
    return reply.code(201).send(map);
  } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
});
app.get('/api/maps/:id', async req => {
  await auth(req); const id = idOf(req.params);
  const [rows] = await pool.execute<RowDataPacket[]>('SELECT document_json FROM editor_map_documents WHERE map_id=?', [id]);
  if (!rows.length) throw Object.assign(new Error('Map not found'), { statusCode: 404 });
  return JSON.parse(rows[0].document_json) as MapDocument;
});
app.get('/api/maps/:id/thumbnail', async (req, reply) => {
  await auth(req); const id = idOf(req.params);
  const mode = (req.query as { mode?: string }).mode;
  const column = mode === 'cell' ? 'cell_thumbnail_png' : 'thumbnail_png';
  const [rows] = await pool.execute<RowDataPacket[]>(`SELECT ${column} AS image FROM editor_map_documents WHERE map_id=?`, [id]);
  if (!rows.length || !rows[0].image) return reply.code(404).send({ error: 'No thumbnail' });
  return reply.type('image/png').send(rows[0].image);
});
app.put('/api/maps/:id/lock', async (req, reply) => {
  const user = await auth(req); edit(user); const id = idOf(req.params);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [docs] = await conn.execute<RowDataPacket[]>('SELECT map_id FROM editor_map_documents WHERE map_id=? FOR UPDATE', [id]);
    if (!docs.length) fail(404, 'Map not found');
    const [rows] = await conn.execute<RowDataPacket[]>('SELECT owner, (expires_at > NOW(3)) AS valid FROM editor_locks WHERE map_id=? FOR UPDATE', [id]);
    if (rows.length && rows[0].owner !== user.sub && rows[0].valid) fail(423, `Map is locked by ${rows[0].owner}`);
    await conn.execute('INSERT INTO editor_locks(map_id, owner, expires_at) VALUES (?, ?, DATE_ADD(NOW(3), INTERVAL 120 SECOND)) ON DUPLICATE KEY UPDATE owner=VALUES(owner), expires_at=VALUES(expires_at)', [id, user.sub]);
    await conn.commit(); return { owner: user.sub, leaseSeconds: 120 };
  } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
});
app.delete('/api/maps/:id/lock', async req => {
  const user = await auth(req); const id = idOf(req.params);
  await pool.execute('DELETE FROM editor_locks WHERE map_id=? AND owner=?', [id, user.sub]);
  return { released: true };
});
app.put('/api/maps/:id', async (req, reply) => {
  const user = await auth(req); edit(user); const id = idOf(req.params);
  const body = (req.body ?? {}) as { map?: MapDocument; expectedVersion?: number; thumbnail?: string; cellThumbnail?: string };
  if (!body.map || body.map.id !== id || !Number.isInteger(body.expectedVersion)) return reply.code(400).send({ error: 'Map and expectedVersion required' });
  const errors = validateMap(body.map);
  if (errors.length) return reply.code(422).send({ error: 'Invalid map', details: errors.slice(0, 30) });
  const normal = png(body.thumbnail), cell = png(body.cellThumbnail);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.execute<RowDataPacket[]>('SELECT version, document_json FROM editor_map_documents WHERE map_id=? FOR UPDATE', [id]);
    if (!rows.length) fail(404, 'Map not found');
    await assertLock(conn, id, user.sub);
    if (rows[0].version !== body.expectedVersion) fail(409, `Version conflict; current version ${rows[0].version}`);
    const before = JSON.parse(rows[0].document_json) as MapDocument;
    const snapshot = await readSnapshot(conn, id);
    if (!snapshot || !before.sourceHash || before.sourceHash !== sourceHash(snapshot)) fail(409, 'Emulator map or related actions changed outside the editor; reimport after reviewing the database');
    const [subareas] = await conn.execute<RowDataPacket[]>('SELECT s.area, a.superarea FROM subareas s JOIN areas a ON a.id=s.area WHERE s.id=?', [body.map.geoposition.subArea]);
    if (!subareas.length || Number(subareas[0].area) !== body.map.geoposition.area || Number(subareas[0].superarea) !== body.map.geoposition.superArea) fail(422, 'Subarea, area and superarea do not match the emulator database');
    const targetErrors = await validateTargets(conn, body.map, before);
    if (targetErrors.length) throw Object.assign(new Error('Invalid map links'), { statusCode: 422, details: targetErrors.slice(0, 30) });
    const map = cloneMap(body.map);
    assertRelatedChangeSafety(before, map, snapshot!);
    try { mapProjection(map); } catch (error) { fail(422, error instanceof Error ? error.message : 'Cannot encode map'); }
    map.version = rows[0].version + 1;
    map.createdAt = before.createdAt;
    map.updatedAt = new Date().toISOString();
    map.author = user.sub;
    await pool.execute('INSERT INTO editor_map_backups(map_id, editor_version, snapshot_json, actor) VALUES (?, ?, ?, ?)', [id, before.version, JSON.stringify(snapshot!), user.sub]);
    await writeProjection(conn, map);
    await applyRelatedChanges(conn, before, map, snapshot!);
    const after = await readSnapshot(conn, id);
    if (!after) fail(500, 'Saved map cannot be read back');
    map.sourceHash = sourceHash(after!);
    await conn.execute('UPDATE editor_map_documents SET document_json=?, version=?, author=?, thumbnail_png=COALESCE(?, thumbnail_png), cell_thumbnail_png=COALESCE(?, cell_thumbnail_png) WHERE map_id=?', [JSON.stringify(map), map.version, user.sub, normal, cell, id]);
    await conn.execute('INSERT INTO editor_map_versions(map_id, version, document_json, author) VALUES (?, ?, ?, ?)', [id, map.version, JSON.stringify(map), user.sub]);
    await audit(conn, user, 'map.save', id, { version: map.version, gfxUsed: gfxUsed(map).length });
    await conn.commit(); return map;
  } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
});
app.get('/api/maps/:id/versions', async req => {
  await auth(req); const id = idOf(req.params);
  const [rows] = await pool.execute<RowDataPacket[]>('SELECT version, author, saved_at AS savedAt FROM editor_map_versions WHERE map_id=? ORDER BY version DESC LIMIT 100', [id]);
  return rows;
});
app.get('/api/maps/:id/versions/:version', async req => {
  await auth(req); const id = idOf(req.params); const version = Number((req.params as { version: string }).version);
  if (!Number.isSafeInteger(version) || version < 1) fail(400, 'Invalid version');
  const [rows] = await pool.execute<RowDataPacket[]>('SELECT document_json FROM editor_map_versions WHERE map_id=? AND version=?', [id, version]);
  if (!rows.length) fail(404, 'Version not found');
  return JSON.parse(rows[0].document_json) as MapDocument;
});
app.get('/api/maps/:id/legacy-sql', async (req, reply) => {
  await auth(req); const id = idOf(req.params);
  const [rows] = await pool.execute<RowDataPacket[]>('SELECT document_json FROM editor_map_documents WHERE map_id=?', [id]);
  if (!rows.length) return reply.code(404).send({ error: 'Map not found' });
  const map = JSON.parse(rows[0].document_json) as MapDocument;
  const values = mapProjection(map).map(v => escapeSql(String(v))).join(', ');
  const sql = `INSERT INTO mapas (${mapColumnList}) VALUES (${values}) ON DUPLICATE KEY UPDATE ${MAP_COLUMNS.slice(1).map(name => `\`${name}\`=VALUES(\`${name}\`)`).join(', ')};\n`;
  return reply.type('text/plain; charset=utf-8').header('Content-Disposition', `attachment; filename="${id}.sql"`).send(sql);
});
app.get('/api/legacy/maps', async req => {
  await auth(req);
  const q = String((req.query as { q?: string }).q ?? '').trim();
  if (q && !/^\d{1,5}$/.test(q)) return [];
  const [rows] = await pool.execute<RowDataPacket[]>(`SELECT m.id, m.fecha AS dateMap FROM mapas m LEFT JOIN editor_map_documents d ON d.map_id=m.id WHERE d.map_id IS NULL ${q ? 'AND CAST(m.id AS CHAR) LIKE ?' : ''} ORDER BY ${q ? '(m.id=?) DESC,' : ''} m.id DESC LIMIT 100`, q ? [`${q}%`, Number(q)] : []);
  return rows;
});
app.post('/api/legacy/swf/decode', async req => {
  const user = await auth(req); edit(user);
  const { data, filename } = (req.body ?? {}) as { data?: string; filename?: string };
  if (!data || data.length > 8_000_000 || !/^[A-Za-z0-9+/=]+$/.test(data)) fail(400, 'Invalid SWF upload');
  try { return decodeAstriaSwf(Buffer.from(data!, 'base64'), filename ?? ''); }
  catch (error) { fail(422, error instanceof Error ? error.message : 'SWF decode failed'); }
});
app.get('/api/world', async req => {
  await auth(req);
  const [rows] = await pool.query<RowDataPacket[]>(`SELECT m.id, m.X AS x, m.Y AS y, COALESCE(s.area,0) AS area, m.subArea
    FROM mapas m LEFT JOIN subareas s ON s.id=m.subArea ORDER BY m.id LIMIT 15000`);
  return rows;
});
app.post('/api/legacy/maps/:id/import', async (req, reply) => {
  const user = await auth(req); edit(user); const id = idOf(req.params);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const snapshot = await readSnapshot(conn, id);
    if (!snapshot) fail(404, 'Legacy map not found');
    const [docs] = await conn.execute<RowDataPacket[]>('SELECT map_id FROM editor_map_documents WHERE map_id=?', [id]);
    if (docs.length) fail(409, 'Already imported');
    const map = await hydrate(conn, snapshot!).catch(error => fail(422, error instanceof Error ? error.message : 'Cannot decode emulator map'));
    map.version = 1; map.author = user.sub;
    await conn.execute('INSERT INTO editor_map_documents(map_id, document_json, version, author) VALUES (?, ?, 1, ?)', [id, JSON.stringify(map), user.sub]);
    await conn.execute('INSERT INTO editor_map_versions(map_id, version, document_json, author) VALUES (?, 1, ?, ?)', [id, JSON.stringify(map), user.sub]);
    await conn.execute('INSERT INTO editor_locks(map_id, owner, expires_at) VALUES (?, ?, DATE_ADD(NOW(3), INTERVAL 120 SECOND)) ON DUPLICATE KEY UPDATE owner=VALUES(owner), expires_at=VALUES(expires_at)', [id, user.sub]);
    await audit(conn, user, 'legacy.import', id);
    await conn.commit(); return reply.code(201).send(map);
  } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
});
app.get('/api/tiles', async req => {
  await auth(req);
  const q = (req.query ?? {}) as { pack?: string; type?: string; cursor?: string; limit?: string; search?: string };
  const type = q.type === undefined ? undefined : Number(q.type);
  const filtered = assets.filter(tile => (type === undefined || tile.type === type) && (!q.pack || tile.pack === q.pack) && (!q.search || String(tile.id).includes(q.search)));
  const cursor = Math.max(0, Number(q.cursor) || 0), limit = Math.min(300, Math.max(1, Number(q.limit) || 120));
  return { items: filtered.slice(cursor, cursor + limit), total: filtered.length, nextCursor: cursor + limit < filtered.length ? cursor + limit : null,
    packs: [...new Set(assets.filter(tile => type === undefined || tile.type === type).map(tile => tile.pack))].sort() };
});
app.post('/api/tiles/rescan', async req => { const user = await auth(req); if (user.role !== 'admin') throw Object.assign(new Error('Admin required'), { statusCode: 403 }); assets = await scanAssets(assetRoot, metadataRoot, assetBaseUrl); return { count: assets.length }; });
app.get('/api/areas', async req => { await auth(req); const [rows] = await pool.query<RowDataPacket[]>('SELECT id, nombre AS name, superarea FROM areas ORDER BY id'); return rows; });
app.get('/api/subareas', async req => { await auth(req); const [rows] = await pool.query<RowDataPacket[]>('SELECT s.id, s.nombre AS name, s.area, a.superarea FROM subareas s JOIN areas a ON a.id=s.area ORDER BY s.id'); return rows; });
app.get('/api/monsters', async req => { await auth(req); const [rows] = await pool.query<RowDataPacket[]>('SELECT id, nombre AS name FROM mobs_modelo ORDER BY id'); return rows; });
app.get('/api/health', async () => { await pool.query('SELECT 1'); return { ok: true }; });
if (existsSync(assetRoot)) await app.register(fastifyStatic, { root: assetRoot, prefix: '/tile-assets/', decorateReply: false });
const dist = resolve(root, 'dist');
if (existsSync(dist)) await app.register(fastifyStatic, { root: dist, prefix: '/', wildcard: true, decorateReply: false });
await app.listen({ host: process.env.HOST ?? '127.0.0.1', port: Number(process.env.PORT ?? 3001) });
