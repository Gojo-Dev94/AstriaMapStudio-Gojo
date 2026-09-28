import { ALPHABET, createMap, type Cell, type FightTeam, type MapDocument } from './domain.ts';
const code = (n: number) => ALPHABET[n] ?? 'a';
const index = (c: string) => { const n = ALPHABET.indexOf(c); if (n < 0) throw new Error(`Invalid legacy character ${c}`); return n; };
function movementType(cell: Cell): number {
  if (cell.unWalkable) return 0;
  if (cell.paddock) return 5;
  if (cell.path) return 7;
  if (cell.door) return 1;
  if (cell.triggerCell) return 2;
  return 4;
}
export function encodeCell(cell: Cell): string {
  const a = Array<number>(10).fill(0);
  const g1 = cell.gfx1 ?? 0, g2 = cell.gfx2 ?? 0, g3 = cell.gfx3 ?? 0;
  const original = cell.rawCellData?.length === 10 ? [...cell.rawCellData].map(index) : null;
  const originalCell = original ? decodeCell(cell.rawCellData!, cell.id) : null;
  const movementUnchanged = originalCell && (['unWalkable', 'paddock', 'path', 'door', 'triggerCell'] as const).every(flag => originalCell[flag] === cell[flag]);
  const kind = movementUnchanged ? (original![2] & 56) >> 3 : movementType(cell);
  a[0] = (original ? original[0] & 32 : 32) | (cell.loS ? 1 : 0) | ((g1 & 0x600) >> 6) | ((g2 & 0x2000) >> 11) | ((g3 & 0x2000) >> 12);
  a[1] = ((cell.rotation[0] & 3) << 4) | (cell.nivSol & 15);
  a[2] = ((kind & 7) << 3) | ((g1 >> 6) & 7);
  a[3] = g1 & 63;
  a[4] = ((cell.inclineSol & 15) << 2) | (cell.flip[0] ? 2 : 0) | ((g2 >> 12) & 1);
  a[5] = (g2 >> 6) & 63;
  a[6] = g2 & 63;
  a[7] = ((cell.rotation[1] & 3) << 4) | (cell.flip[1] ? 8 : 0) | (cell.flip[2] ? 4 : 0) | (cell.io ? 2 : 0) | ((g3 >> 12) & 1);
  a[8] = (g3 >> 6) & 63;
  a[9] = g3 & 63;
  return a.map(code).join('');
}
export function decodeCell(data: string, id: number): Cell {
  if (data.length !== 10) throw new Error('Legacy cell must have 10 characters');
  const a = [...data].map(index);
  const kind = (a[2] & 56) >> 3;
  const fromNull = (n: number) => n === 0 ? null : n;
  return { id, gfx1: fromNull(((a[0] & 24) << 6) + ((a[2] & 7) << 6) + a[3]),
    gfx2: fromNull(((a[0] & 4) << 11) + ((a[4] & 1) << 12) + (a[5] << 6) + a[6]),
    gfx3: fromNull(((a[0] & 2) << 12) + ((a[7] & 1) << 12) + (a[8] << 6) + a[9]),
    loS: Boolean(a[0] & 1), unWalkable: kind === 0, paddock: kind === 5, path: kind === 7,
    door: kind === 1, triggerCell: kind === 2, io: Boolean(a[7] & 2), fightCell: 0,
    nivSol: a[1] & 15, inclineSol: (a[4] & 60) >> 2,
    rotation: [(a[1] & 48) >> 4, (a[7] & 48) >> 4, 0],
    flip: [Boolean(a[4] & 2), Boolean(a[7] & 8), Boolean(a[7] & 4)], rawCellData: data };
}
export const encodeMapData = (map: MapDocument) => map.cells.map(encodeCell).join('');
export function decodeMapData(data: string, id: number, width: number, height: number): MapDocument {
  const map = createMap(id, width, height);
  if (data.length !== map.cells.length * 10) throw new Error(`Expected ${map.cells.length * 10} mapData characters, got ${data.length}`);
  map.cells = map.cells.map((_, i) => decodeCell(data.slice(i * 10, i * 10 + 10), i));
  return map;
}
export function encodeFightPlaces(map: MapDocument): string {
  const side = (team: FightTeam) => map.cells.filter(cell => cell.fightCell === team).map(cell => code(Math.floor(cell.id / 64)) + code(cell.id % 64)).join('');
  const canonical = `${side(1)}|${side(2)}`;
  if (map.rawFightPlaces !== undefined && map.fightPlaceBaseline === canonical) return map.rawFightPlaces;
  if (map.fightPlacesMalformed) throw new Error('Fight positions contain unsupported legacy cells; repair them in the database before changing fight positions');
  return `${canonical}${map.fightPlaceSuffix ? `|${map.fightPlaceSuffix}` : ''}`;
}
export function applyFightPlaces(map: MapDocument, data: string): MapDocument {
  const parts = data.split('|');
  map.rawFightPlaces = data;
  if (parts.length < 2 || parts.slice(0, 2).some(part => part.length % 2)) map.fightPlacesMalformed = true;
  map.fightPlaceSuffix = parts.slice(2).join('|');
  for (const cell of map.cells) cell.fightCell = 0;
  for (const [teamIndex, part] of parts.slice(0, 2).entries()) for (let i = 0; i < part.length; i += 2) {
    const id = index(part[i]) * 64 + index(part[i + 1]);
    if (!map.cells[id]) { map.fightPlacesMalformed = true; continue; }
    map.cells[id].fightCell = (teamIndex + 1) as FightTeam;
  }
  const side = (team: FightTeam) => map.cells.filter(cell => cell.fightCell === team).map(cell => code(Math.floor(cell.id / 64)) + code(cell.id % 64)).join('');
  map.fightPlaceBaseline = `${side(1)}|${side(2)}`;
  return map;
}
function unescapeLegacy(data: string): string { try { return decodeURIComponent(data); } catch { return data; } }
export function decryptLegacyMapData(encrypted: string, hexKey: string): string {
  if (!/^(?:[a-fA-F0-9]{2})+$/.test(hexKey)) throw new Error('Invalid legacy key');
  const key = unescapeLegacy(String.fromCharCode(...(hexKey.match(/../g) ?? []).map(n => parseInt(n, 16))));
  const checksum = ([...key].reduce((sum, char) => sum + (char.charCodeAt(0) % 16), 0) % 16) * 2;
  if (!key || !/^(?:[a-fA-F0-9]{2})+$/.test(encrypted)) throw new Error('Invalid encrypted mapData');
  let output = '';
  for (let i = 0; i < encrypted.length; i += 2) output += String.fromCharCode(parseInt(encrypted.slice(i, i + 2), 16) ^ key.charCodeAt((i / 2 + checksum) % key.length));
  return unescapeLegacy(output);
}
export interface LegacyRow { id: number; date?: string; fecha?: string; width?: number; ancho?: number; heigth?: number; height?: number; alto?: number; mapData: string; key?: string; places?: string | null; posPelea?: string | null; monsters?: string; mobs?: string; mappos?: string; numgroup?: number; maxGrupoMobs?: number; groupmaxsize?: number; maxMobsPorGrupo?: number; minMobsPorGrupo?: number; minNivelGrupoMob?: number; maxNivelGrupoMob?: number; maxMercantes?: number; maxPeleas?: number; bgID?: number; musicID?: number; ambienteID?: number; outDoor?: number; X?: number; Y?: number; subArea?: number; area?: number; superarea?: number; capabilities?: number }
export function importLegacyRow(row: LegacyRow): MapDocument {
  const expectedLength = (Number(row.alto ?? row.heigth ?? row.height) * (Number(row.ancho ?? row.width) * 2 - 1) - Number(row.ancho ?? row.width) + 1) * 10;
  const data = row.key && /^(?:[a-fA-F0-9]{2})+$/.test(row.mapData) ? decryptLegacyMapData(row.mapData, row.key) : row.mapData;
  if (data.length !== expectedLength) throw new Error(`Expected ${expectedLength} mapData characters, got ${data.length}`);
  const map = decodeMapData(data, Number(row.id), Number(row.ancho ?? row.width), Number(row.alto ?? row.heigth ?? row.height));
  map.dateMap = row.fecha ?? row.date ?? 'AME';
  map.key = row.key ?? '';
  if (row.posPelea !== undefined || row.places !== undefined) applyFightPlaces(map, row.posPelea ?? row.places ?? '');
  map.combat.mobs = row.mobs ?? row.monsters ?? '';
  map.combat.nbGroups = Number(row.maxGrupoMobs ?? row.numgroup ?? 5);
  map.combat.groupMaxSize = Number(row.maxMobsPorGrupo ?? row.groupmaxsize ?? 8);
  map.combat.minGroupSize = Number(row.minMobsPorGrupo ?? 1);
  map.combat.minGroupLevel = Number(row.minNivelGrupoMob ?? 0);
  map.combat.maxGroupLevel = Number(row.maxNivelGrupoMob ?? 0);
  map.combat.maxMerchants = Number(row.maxMercantes ?? 0);
  map.combat.maxFights = Number(row.maxPeleas ?? 99);
  map.backgroundId = row.bgID ? Number(row.bgID) : null;
  map.musicId = Number(row.musicID ?? 0);
  map.ambianceId = Number(row.ambienteID ?? 0);
  map.outdoor = Boolean(row.outDoor ?? 0);
  map.capabilities = Number(row.capabilities ?? 0);
  if (row.X !== undefined && row.Y !== undefined && row.subArea !== undefined) map.geoposition = { x: Number(row.X), y: Number(row.Y), subArea: Number(row.subArea), area: Number(row.area ?? 0), superArea: Number(row.superarea ?? 0) };
  if (row.mappos) {
    const [x, y, subArea] = row.mappos.split(',').map(Number);
    if ([x, y, subArea].every(Number.isFinite)) map.geoposition = { ...map.geoposition, x, y, subArea };
  }
  return map;
}
