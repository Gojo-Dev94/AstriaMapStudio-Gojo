# Atlanta emulator database adapter

The local XAMPP MariaDB 10.4.32 server hosts the three databases named by the emulator's `config.txt`: `duty_cuentas_hero2`, `duty_dinamicos_hero2`, and `duty_estaticos_hero2`. The editor connects only to the static database. [emulator-schema.json](emulator-schema.json) is a read-only inventory from `information_schema` of every table and column in all three databases, including the editor tables created at startup. Refresh it with `npm run schema:inspect -- duty_cuentas_hero2 duty_dinamicos_hero2 duty_estaticos_hero2`. It contains definitions, not account or game row values.

## Verified map schema

`mapas` has 23 columns, in this order: `id`, `fecha`, `ancho`, `alto`, `bgID`, `musicID`, `ambienteID`, `outDoor`, `capabilities`, `posPelea`, `key`, `mapData`, `mobs`, `X`, `Y`, `subArea`, `maxGrupoMobs`, `maxMobsPorGrupo`, `minNivelGrupoMob`, `maxNivelGrupoMob`, `maxMercantes`, `maxPeleas`, `minMobsPorGrupo`. The API uses named columns in SQL rather than relying on their physical order. `server/atlanta.ts` maps each one to `MapDocument`. `server/index.ts` rejects an incompatible schema at startup.

The emulator's `GestorSQL.RESULSET_MAP` reads these names and `Mapa` consumes the resulting values. `subArea` must exist in `subareas`; the editor derives `area` and `superarea` from `subareas` and `areas`. The emulator identifies maps with a signed 16-bit `Short`, so the editor limits new IDs to 1–32767. The live database currently has 9,305 `mapas` rows, 24,239 `celdas_accion` rows, 475 `accion_pelea` rows, and 423 `mobs_fix` rows.

## Related tables

| Editor field | Emulator table and columns | Write rule |
| --- | --- | --- |
| Cell teleport target | `celdas_accion(mapa, celda, accion, args, condicion)` | Only `accion=0` and simple `mapId,cellId` arguments are edited. Other actions and conditions are retained. |
| End of fight target | `accion_pelea(mapa, tipoPelea, accion, args, condicion, descripcion)` | Only a single simple `tipoPelea=4`, `accion=0` teleport is edited. Other fight actions remain untouched. |
| Fixed monster group | `mobs_fix(mapa, celda, mobs, tipo, condicion, ...)` | A single group can be edited; all other columns on an existing row are retained. Multiple groups are preserved but cannot be changed by the single-group UI. |
| World placement | `mapas(X, Y, subArea)` plus `subareas(area)` and `areas(superarea)` | The UI keeps the hierarchy consistent and validates it before save. |
| Monster catalogue | `mobs_modelo(id, nombre)` | Read only. |

The editor detects outside changes to the map row and related action rows with a SHA-256 snapshot in the imported document. A stale save returns HTTP 409. It stores the previous SQL rows in `editor_map_backups` before a save. The game's three main map/action tables are MyISAM while editor tables are InnoDB; a cross-table commit cannot be atomic under the current engine mix. Stop concurrent emulator map writes while publishing and retain normal database backups.

## Data preservation and validation

On the live database, 9,303 of 9,305 rows imported and re-encoded with identical `mapData` and `posPelea`. The codec preserves the active bit, less common movement codes, fight cell order, empty fight strings, and an optional third fight color component. Ninety rows have a nonempty `key` but plaintext `mapData`, which the emulator already accepts; their bytes and key are preserved. Rows 7787 and 10986 have map-data lengths inconsistent with their stored dimensions and are rejected until repaired in the database.

The API creates only `editor_*` tables in the existing static database. Importing a map creates an editor document without rewriting its game row. Saving projects all 23 `mapas` columns and changes only related action rows represented by edited controls. SQL export includes the `mapas` row; use the live API for related table updates.

Integration was verified against a disposable copy of the emulator schema: import and no edit save retained every `mapas` column, new map creation and related table insert/update/delete worked, and an external change caused HTTP 409. The disposable database was removed after the check.
