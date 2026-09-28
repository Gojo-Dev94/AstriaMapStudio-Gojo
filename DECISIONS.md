# Architecture decisions and source audit

Status: 2026-09-26. The source files below were inspected in the supplied Visual Basic checkout. The prompt takes precedence where it disagrees with the old behavior.

## ADR 001 — Canonical document and legacy projection

**Options.** Keep the 10-character-per-cell game encoding as the only source of truth; or use a versioned JSON document and emit game-compatible columns on save.

**Trade-off.** The game encoding is compact and directly consumable by older servers, but cannot represent trigger targets, the full geoposition hierarchy, author/version metadata, or arbitrary future fields. JSON is larger but inspectable, extensible, and safe to parse.

**Decision.** `MapDocument` JSON schema version 1 is canonical. The actual emulator stores map fields in `mapas`, using `fecha`, `ancho`, `alto`, `posPelea`, `mobs`, `X`, `Y`, `subArea`, and the remaining columns documented in `docs/ATLANTA_ADAPTER.md`. `server/atlanta.ts` projects all 23 columns by name. Imported keys and unchanged packed cell bytes are retained. Conversion functions are in `src/legacy.ts` and were checked against the live rows.

The editor tables intentionally do not place a foreign key on `mapas`: it is MyISAM. New editor history and lease tables reference the editor document instead; the API enforces the map relationship and checks a source fingerprint before saving.

**Evidence/conflict.** `Patterns Dofus/Map.vb:22-38` has all in-memory fields, while `MySQL.vb:32-64` writes only a subset. `Builder.vb:7-104` packs 10 base64-like symbols per cell; `Map.vb:81-103` decodes the same fields. `MapEditor/Cell.vb:16-35` contains additional flags but the packed format does not preserve every independent boolean. The prompt requests all fields, so the JSON document owns them.

## ADR 002 — Isometric geometry

**Options.** Approximate a rectangular diamond grid; or reproduce alternating long and short rows.

**Decision.** Use `height * (width * 2 - 1) - width + 1` cells, row stride `2*width-1`, 26 px half-cell size. Long rows have `width` diamonds; short rows have `width-1`. Top, bottom and the two long-row edge columns are blocked on creation. The render positions are deterministic and are shared by hit testing.

**Evidence.** `MapEditor/MapEditor.vb:354-410` builds the two alternating row families. `MapEditor/MapEditor.vb:757-765` marks borders. `Patterns Dofus/Map.vb:37` defines the array upper bound, which means the actual element count has a final `+1`.

## ADR 003 — Canvas 2D now, atlas-capable renderer later

**Options.** PixiJS/WebGL from day one; or Canvas 2D with a small renderer and future atlas substitution.

**Trade-off.** PixiJS has stronger batching for large scenes, but adds GPU asset lifecycle complexity to a migration whose geometry and data contracts are still being verified. Canvas 2D is sufficient for the current map sizes and simpler to compare with GDI rendering.

**Decision.** Render to Canvas 2D with viewport culling, image caching, DPR scaling, pan/zoom, and three passes for layers. Generate optional 2048 px atlases with `npm run atlas`; switching `drawImage` to atlas regions is a measured optimization, not claimed complete. Performance budget and measurement gates are in `TECHNICAL_SPEC.md`.

## ADR 004 — Sprite coordinates are origins, not atlas offsets

**Options.** Interpret XML `<X>/<Y>` as coordinates within a sheet as suggested by the prompt; or as the PNG's draw origin as used by the legacy source.

**Decision.** The legacy XML values are sprite origins: `MapEditor/Cell.vb` computes `Base_X/Base_Y` from `Get_Ground_Pos` / `Get_Object_Pos` and subtracts them when placing each separately loaded PNG. `Main/Main.vb:778-842` walks individual `Images/grounds/` and `Images/objects/` PNGs. We preserve origins in `TileAsset.x/y`. The generated atlas metadata has separate `x/y` crop offsets and `originX/originY` for drawing. This directly resolves the prompt's conflicting interpretation.

## ADR 005 — FightPlaces codec

**Options.** Store only arrays of team cells; or also encode the game server string.

**Decision.** Canonical cell `fightCell` is 0/1/2. For `posPelea`, encode each ID as two symbols in `abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_`: `alphabet[floor(id/64)] + alphabet[id%64]`. Concatenate team 1, `|`, team 2. Reject a newly painted fight cell ID ≥4096. Imported fight strings retain their original order, empty form, and optional color suffix. Existing out-of-range entries remain unchanged until a game-specific repair is performed.

**Evidence.** `Maps/FightCell/FightCellsManager.vb:6-65`.

## ADR 006 — Legacy `.ame` and SWF

**Options.** Keep BinaryFormatter/Flasm; run an offline migration; or parse limited SWF contents without executing script.

**Decision.** Do not deserialize `.ame` on the server. It is a .NET BinaryFormatter object graph (`MapEditor/MapEditor.vb:874-886`) and requires a controlled trusted exporter for migration. SWF export is retired. `server/swf.ts` imports only FWS/CWS files matching this Astria Flasm constant-pool pattern, extracts mapData and map metadata, and rejects other structures. JSON + PNG/atlas assets is the new portable output. A game-server-specific SWF adapter may be added only if a real server requires it.

**Evidence.** `SWF/Flasm.vb:25-42` emits the map constants; `SWF/UnPacker.vb:10-49` decompiles old files by fragile action-string offsets. A bundled `Maps/14444/14444_AME.swf` is exercised in the tests.

## ADR 007 — Geoposition in Atlanta

**Conflict.** The request describes `mappos="x,y,area"`. `MySQL.vb:58` writes `X,Y,SubArea`, while `Selector/ImportMapByBDD.vb:98-103` reads the same third number into `Area`. These are inconsistent.

**Options.** Follow the import code and interpret as `area`; or follow the export code and interpret as `subArea`.

**Decision.** The Atlanta emulator has separate `mapas.X`, `mapas.Y`, and `mapas.subArea` columns. The editor derives `area` and `superArea` from the live `subareas` and `areas` tables and verifies the hierarchy before saving. The earlier `mappos` interpretation applies only to the original VB editor, not this adapter.

## ADR 008 — Concurrency and authorization

**Options.** Exclusive persistent lock; optimistic version only; or short edit lease plus optimistic version.

**Decision.** A 120 s lease gates writes and renews every 60 s, while `expectedVersion` prevents stale overwrites. A 409 response preserves the IndexedDB draft for manual review/export. No automatic field merge: layered image edits and link changes are not safely mergeable without a shared operation log. JWTs expire after 8 h; user roles are viewer/editor/admin; only admin can rescan assets. Passwords use scrypt with per-user salt. All writes use parameterized SQL and an audit row.

## ADR 009 — Correct old bugs, do not reproduce them

- `MapEditor/MapEditor.vb:717-731` checks `calque=3` twice, so the ground-layer global delete branch is unreachable. The new operation handles layers 1, 2 and 3.
- `MySQL.vb:67-90` appears to swap `endfight_action` and `mobgroups_fix` in its `DELETE`/`INSERT` helper methods. The Atlanta adapter uses the verified `accion_pelea` and `mobs_fix` tables separately.
- `MapEditor/Cell.vb:42-71` uses `Trigger` in the type getter, while `TriggerCell` is set in the setter; `Main/Main.vb:358-374` writes trigger SQL directly to a file. The new editor represents trigger source and destination explicitly in JSON and validates the target.
- `MySQL.vb:32-63` concatenates SQL values into commands. The API uses prepared statements.

## ADR 010 — Deployment and scope gates

**Decision.** The supplied local XAMPP MariaDB 10.4.32 instance is the verified integration target. The app is bound to `127.0.0.1` by default. CI runs tests and a production frontend build. The Docker Compose example needs a restored Atlanta schema before use. Because `mapas`, `celdas_accion`, and `accion_pelea` are MyISAM, a save across these tables cannot be atomic with InnoDB editor history; the API stores a prewrite backup and rejects stale source snapshots. Live database API integration passed on a disposable schema copy; browser E2E and production concurrency gates remain open.
