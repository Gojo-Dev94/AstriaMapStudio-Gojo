import type { MapDocument, TriggerTarget } from '../src/domain.ts';
import { encodeFightPlaces, encodeMapData } from '../src/legacy.ts';

// Exact column names and order from duty_estaticos_hero2.mapas. Never use REPLACE:
// the emulator keeps related actions in other tables.
export const MAP_COLUMNS = [
  'id', 'fecha', 'ancho', 'alto', 'bgID', 'musicID', 'ambienteID', 'outDoor',
  'capabilities', 'posPelea', 'key', 'mapData', 'mobs', 'X', 'Y', 'subArea',
  'maxGrupoMobs', 'maxMobsPorGrupo', 'minNivelGrupoMob', 'maxNivelGrupoMob',
  'maxMercantes', 'maxPeleas', 'minMobsPorGrupo',
] as const;

export const mapColumnList = MAP_COLUMNS.map(name => `\`${name}\``).join(', ');
export const mapPlaceholders = MAP_COLUMNS.map(() => '?').join(', ');
export const mapUpdateList = MAP_COLUMNS.filter(name => name !== 'id').map(name => `\`${name}\`=?`).join(', ');

export function mapProjection(map: MapDocument): (string | number)[] {
  return [
    map.id, map.dateMap, map.width, map.height, map.backgroundId ?? 0, map.musicId,
    map.ambianceId, Number(map.outdoor), map.capabilities, encodeFightPlaces(map),
    map.key, encodeMapData(map), map.combat.mobs, map.geoposition.x, map.geoposition.y,
    map.geoposition.subArea, map.combat.nbGroups, map.combat.groupMaxSize,
    map.combat.minGroupLevel, map.combat.maxGroupLevel, map.combat.maxMerchants,
    map.combat.maxFights, map.combat.minGroupSize,
  ];
}

export function parseTeleport(args: unknown): TriggerTarget | null {
  if (typeof args !== 'string' || !/^\d+,\d+$/.test(args)) return null;
  const [mapId, cellId] = args.split(',').map(Number);
  return Number.isSafeInteger(mapId) && Number.isSafeInteger(cellId) && mapId > 0 && cellId >= 0 ? { mapId, cellId } : null;
}

export const teleportArgs = (target: TriggerTarget) => `${target.mapId},${target.cellId}`;
