import { describe, expect, it } from 'vitest';
import { cellCount, cellPosition, createMap, isBorderCell, validateMap } from './domain.ts';
import { applyFightPlaces, decodeMapData, encodeFightPlaces, encodeMapData, importLegacyRow } from './legacy.ts';
import { mapProjection } from '../server/atlanta.ts';

describe('Astria topology', () => {
  it('creates exact alternating row count and border cells', () => {
    const map = createMap(7);
    expect(map.cells).toHaveLength(479);
    expect(cellCount(15, 17)).toBe(479);
    expect(cellPosition(0, 15)).toEqual({ x: 26, y: 13 });
    expect(cellPosition(15, 15)).toEqual({ x: 52, y: 26 });
    expect(cellPosition(29, 15)).toEqual({ x: 26, y: 39 });
    expect(isBorderCell(0, 15, 17)).toBe(true);
    expect(isBorderCell(16, 15, 17)).toBe(false);
    expect(map.cells[0].unWalkable).toBe(true);
    expect(map.cells[16].unWalkable).toBe(false);
  });
  it('preserves actionless legacy trigger cells and rejects invalid explicit targets', () => {
    const map = createMap(8);
    map.cells[16].triggerCell = true;
    expect(validateMap(map)).toEqual([]);
    map.cells[16].trigger = { mapId: 0, cellId: 1 };
    expect(validateMap(map)).toContain('Trigger 16 has no valid target');
    map.cells[16].trigger = { mapId: 9, cellId: 1 };
    expect(validateMap(map)).toEqual([]);
    map.cells[16].id = 99;
    expect(validateMap(map)).toContain('Orphaned cell 16');
  });
});
describe('Legacy codec', () => {
  it('round trips tile IDs, rotations, flips, flags and fight places', () => {
    const map = createMap(7);
    const cell = map.cells[16];
    cell.gfx1 = 1089; cell.gfx2 = 8197; cell.gfx3 = 12345;
    cell.rotation = [3, 2, 0]; cell.flip = [true, true, true]; cell.io = true;
    cell.path = true; cell.loS = false; cell.nivSol = 12; cell.inclineSol = 4; cell.fightCell = 1;
    map.cells[17].fightCell = 2;
    const encoded = encodeMapData(map);
    expect(encoded).toHaveLength(map.cells.length * 10);
    const restored = decodeMapData(encoded, map.id, map.width, map.height);
    applyFightPlaces(restored, encodeFightPlaces(map));
    expect(restored.cells[16]).toMatchObject({ gfx1: 1089, gfx2: 8197, gfx3: 12345, rotation: [3, 2, 0], flip: [true, true, true], io: true, path: true, loS: false, nivSol: 12, inclineSol: 4, fightCell: 1 });
    expect(restored.cells[17].fightCell).toBe(2);
  });
  it('imports the legacy DB row and interprets mappos as subarea', () => {
    const source = createMap(12, 3, 3);
    const row = { id: 12, date: 'AME', width: 3, heigth: 3, mapData: encodeMapData(source), places: 'af|ag', monsters: '31', mappos: '2,-3,7', numgroup: 5, groupmaxsize: 6 };
    const imported = importLegacyRow(row);
    expect(imported.geoposition).toMatchObject({ x: 2, y: -3, subArea: 7 });
    expect(imported.combat.mobs).toBe('31');
    expect(imported.cells[5].fightCell).toBe(1);
  });
  it('preserves Atlanta cell bytes and fight-place ordering on a no edit projection', () => {
    const source = createMap(12, 3, 3);
    const data = encodeMapData(source);
    const first = 'a' + data.slice(1, 2) + 'y' + data.slice(3);
    const row = { id: 12, fecha: '0609111108', ancho: 3, alto: 3, bgID: 71, musicID: 118, ambienteID: 6, outDoor: 1,
      capabilities: 7, posPelea: 'agaf|ah|red', key: 'unused-key', mapData: first, mobs: '31', X: -9, Y: -12, subArea: 33,
      maxGrupoMobs: 8, maxMobsPorGrupo: 8, minNivelGrupoMob: 1, maxNivelGrupoMob: 100, maxMercantes: 5, maxPeleas: 99, minMobsPorGrupo: 1 };
    const map = importLegacyRow(row);
    const values = mapProjection(map);
    expect(values).toEqual([12, '0609111108', 3, 3, 71, 118, 6, 1, 7, 'agaf|ah|red', 'unused-key', first, '31', -9, -12, 33, 8, 8, 1, 100, 5, 99, 1]);
  });
  it('rejects malformed fight strings and cell lengths', () => {
    const map = createMap(1, 2, 2);
    expect(() => applyFightPlaces(map, 'odd|')).toThrow();
    expect(() => decodeMapData('abc', 1, 2, 2)).toThrow();
  });
});
