export const ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_';
export const CELL_HALF = 26;
export type FightTeam = 0 | 1 | 2;
export type Layer = 1 | 2 | 3;
export type CellFlag = 'unWalkable' | 'loS' | 'path' | 'paddock' | 'door' | 'triggerCell' | 'io';
export interface TriggerTarget { mapId: number; cellId: number }
export interface Cell {
  id: number;
  gfx1: number | null;
  gfx2: number | null;
  gfx3: number | null;
  unWalkable: boolean;
  loS: boolean;
  path: boolean;
  paddock: boolean;
  door: boolean;
  triggerCell: boolean;
  io: boolean;
  fightCell: FightTeam;
  nivSol: number;
  inclineSol: number;
  rotation: [number, number, number];
  flip: [boolean, boolean, boolean];
  rawCellData?: string;
  trigger?: TriggerTarget;
}
export interface MapDocument {
  format: 'astria-map';
  schemaVersion: 1;
  id: number;
  dateMap: string;
  width: number;
  height: number;
  backgroundId: number | null;
  musicId: number;
  ambianceId: number;
  outdoor: boolean;
  capabilities: number;
  geoposition: { x: number; y: number; area: number; subArea: number; superArea: number };
  combat: { nbGroups: number; groupMaxSize: number; minGroupSize: number; minGroupLevel: number; maxGroupLevel: number; maxMerchants: number; maxFights: number; mobs: string; fixedMobs: string; fixedCell: number | null };
  fightPlaceSuffix?: string;
  rawFightPlaces?: string;
  fightPlaceBaseline?: string;
  fightPlacesMalformed?: boolean;
  sourceHash?: string;
  nextRoom: number | null;
  nextCell: number | null;
  key: string;
  cells: Cell[];
  version: number;
  author: string;
  createdAt: string;
  updatedAt: string;
}
export interface TileAsset { id: number; type: 0 | 1 | 2; pack: string; url: string; x: number; y: number }
export interface MapSummary { id: number; dateMap: string; version: number; updatedAt: string; thumbnailUrl: string }
export const cellCount = (width: number, height: number) => height * (width * 2 - 1) - width + 1;
export const rowStride = (width: number) => width * 2 - 1;
export function cellPosition(id: number, width: number): { x: number; y: number } {
  const row = Math.floor(id / rowStride(width));
  const col = id % rowStride(width);
  if (col < width) return { x: CELL_HALF + col * CELL_HALF * 2, y: row * CELL_HALF + CELL_HALF / 2 };
  return { x: CELL_HALF * 2 + (col - width) * CELL_HALF * 2, y: row * CELL_HALF + CELL_HALF };
}
export function isBorderCell(id: number, width: number, height: number): boolean {
  const row = Math.floor(id / rowStride(width));
  const col = id % rowStride(width);
  return row === 0 && col < width || row === height - 1 || col === 0 || col === width - 1;
}
export function createCell(id: number, border = false): Cell {
  return { id, gfx1: null, gfx2: null, gfx3: null, unWalkable: border, loS: true, path: false, paddock: false,
    door: false, triggerCell: false, io: false, fightCell: 0, nivSol: 7, inclineSol: 1,
    rotation: [0, 0, 0], flip: [false, false, false] };
}
export function createMap(id: number, width = 15, height = 17, author = ''): MapDocument {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2 || width > 100 || height > 100) throw new Error('Invalid map size');
  const now = new Date().toISOString();
  return { format: 'astria-map', schemaVersion: 1, id, dateMap: 'AME', width, height,
    backgroundId: null, musicId: 0, ambianceId: 0, outdoor: false, capabilities: 0,
    geoposition: { x: 0, y: 0, area: 0, subArea: 0, superArea: 0 },
    combat: { nbGroups: 5, groupMaxSize: 8, minGroupSize: 1, minGroupLevel: 0, maxGroupLevel: 0, maxMerchants: 0, maxFights: 99, mobs: '', fixedMobs: '', fixedCell: null },
    fightPlaceSuffix: '',
    nextRoom: null, nextCell: null, key: '',
    cells: Array.from({ length: cellCount(width, height) }, (_, cellId) => createCell(cellId, isBorderCell(cellId, width, height))),
    version: 0, author, createdAt: now, updatedAt: now };
}
export function cloneMap(map: MapDocument): MapDocument { return structuredClone(map); }
export function gfxUsed(map: MapDocument): number[] {
  return [...new Set(map.cells.flatMap(cell => [cell.gfx1, cell.gfx2, cell.gfx3]).filter((id): id is number => id !== null))].sort((a, b) => a - b);
}
export function validateMap(map: MapDocument): string[] {
  const errors: string[] = [];
  if (!map || typeof map !== 'object') return ['Map must be an object'];
  if (map.format !== 'astria-map' || map.schemaVersion !== 1) errors.push('Unsupported project format');
  if (!Number.isSafeInteger(map.id) || map.id < 1 || map.id > 32767) errors.push('Map ID must fit the emulator Short range (1–32767)');
  if (!Number.isInteger(map.width) || !Number.isInteger(map.height) || map.width < 2 || map.height < 2 || map.width > 100 || map.height > 100) errors.push('Invalid map size');
  if (!map.geoposition || !map.combat || !Array.isArray(map.cells) || map.cells.length !== cellCount(map.width, map.height)) return [...errors, 'Map is missing required fields or cell array length does not match geometry'];
  if (typeof map.dateMap !== 'string' || map.dateMap.length > 255 || typeof map.combat.mobs !== 'string' || typeof map.combat.fixedMobs !== 'string') errors.push('Invalid map metadata');
  if (![map.geoposition.x, map.geoposition.y, map.geoposition.area, map.geoposition.subArea, map.geoposition.superArea, map.combat.nbGroups, map.combat.groupMaxSize, map.combat.minGroupSize, map.combat.minGroupLevel, map.combat.maxGroupLevel, map.combat.maxMerchants, map.combat.maxFights].every(Number.isSafeInteger)) errors.push('Invalid geoposition or combat values');
  if (map.combat.nbGroups < 0 || map.combat.groupMaxSize < 0 || map.combat.minGroupSize < 0 || map.combat.minGroupLevel < 0 || map.combat.maxGroupLevel < 0 || map.combat.maxMerchants < 0 || map.combat.maxFights < 0 || map.combat.maxFights > 127 || typeof map.outdoor !== 'boolean' || !Number.isSafeInteger(map.capabilities) || !Number.isSafeInteger(map.musicId) || !Number.isSafeInteger(map.ambianceId)) errors.push('Invalid map settings');
  if (map.fightPlaceSuffix !== undefined && (typeof map.fightPlaceSuffix !== 'string' || map.fightPlaceSuffix.length > 200)) errors.push('Invalid fight place suffix');
  let walkable = 0;
  for (let i = 0; i < map.cells.length; i++) {
    const cell = map.cells[i];
    if (!cell || cell.id !== i) { errors.push(`Orphaned cell ${i}`); continue; }
    if (!Array.isArray(cell.rotation) || cell.rotation.length !== 3 || cell.rotation.some(n => !Number.isInteger(n) || n < 0 || n > 3) || !Array.isArray(cell.flip) || cell.flip.length !== 3 || cell.flip.some(x => typeof x !== 'boolean')) { errors.push(`Invalid tile transform at ${i}`); continue; }
    if (![cell.unWalkable, cell.loS, cell.path, cell.paddock, cell.door, cell.triggerCell, cell.io].every(x => typeof x === 'boolean') || ![0, 1, 2].includes(cell.fightCell)) errors.push(`Invalid flags at ${i}`);
    if (!cell.unWalkable) walkable++;
    if (cell.fightCell && i >= 4096) errors.push(`Fight position ${i} exceeds legacy range`);
    if (cell.trigger && (!Number.isSafeInteger(cell.trigger.mapId) || cell.trigger.mapId < 1 || !Number.isSafeInteger(cell.trigger.cellId) || cell.trigger.cellId < 0)) errors.push(`Trigger ${i} has no valid target`);
    if (cell.nivSol < 0 || cell.nivSol > 15 || cell.inclineSol < 0 || cell.inclineSol > 15) errors.push(`Invalid ground values at ${i}`);
    for (const [layer, gfx] of [cell.gfx1, cell.gfx2, cell.gfx3].entries()) if (gfx !== null && (!Number.isSafeInteger(gfx) || gfx < 0 || gfx > (layer === 0 ? 2047 : 16383))) errors.push(`Gfx${layer + 1} ID ${gfx} at ${i} exceeds legacy range`);
  }
  if (!walkable && !map.sourceHash) errors.push('Map has no walkable cells');
  if (map.combat.fixedCell !== null && (!Number.isSafeInteger(map.combat.fixedCell) || map.combat.fixedCell < 0 || map.combat.fixedCell >= map.cells.length)) errors.push('Fixed monster group cell is out of range');
  if ((map.combat.fixedCell === null) !== (map.combat.fixedMobs.length === 0)) errors.push('Fixed monster group needs both a cell and monster list');
  if ((map.nextRoom === null) !== (map.nextCell === null)) errors.push('End fight target must include a map and cell');
  if (map.nextRoom !== null && (!Number.isSafeInteger(map.nextRoom) || map.nextRoom < 1 || !Number.isSafeInteger(map.nextCell) || map.nextCell! < 0)) errors.push('Invalid end fight target');
  if (map.nextRoom === map.id) errors.push('End fight destination must be another map');
  return errors;
}
