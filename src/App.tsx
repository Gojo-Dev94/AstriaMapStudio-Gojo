import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, downloadText, fetchAllTiles, getToken, hasToken, setToken } from './api.ts';
import { cloneMap, gfxUsed, validateMap, type Cell, type CellFlag, type Layer, type MapDocument, type MapSummary, type TileAsset } from './domain.ts';
import { encodeCell } from './legacy.ts';
import { deleteDraft, getDraft, putDraft } from './drafts.ts';
import { MapCanvas } from './MapCanvas.tsx';
import { ImageCache, makeCellThumbnail, makeThumbnail } from './render.ts';
import { useEditor } from './store.ts';

const errText = (error: unknown) => error instanceof ApiError ? `${error.message}${error.details?.length ? ': ' + error.details.join('; ') : ''}` : error instanceof Error ? error.message : String(error);
function Login({ onLogin }: { onLogin: (user: { sub: string; role: string }) => void }) {
  const [username, setUsername] = useState('admin'); const [password, setPassword] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  return <main className="login-page"><form className="login-card" onSubmit={async event => {
    event.preventDefault(); setBusy(true); setError('');
    try { const result = await api.login(username, password); setToken(result.token); onLogin(result.user); }
    catch (error) { setError(errText(error)); } finally { setBusy(false); }
  }}><div className="brand-mark">◈</div><h1>Astria Map Studio</h1><p>Éditeur isométrique moderne</p>
    <label>Utilisateur<input autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} required /></label>
    <label>Mot de passe<input autoComplete="current-password" type="password" value={password} onChange={e => setPassword(e.target.value)} required /></label>
    {error && <div className="error" role="alert">{error}</div>}<button className="primary" disabled={busy}>{busy ? 'Connexion…' : 'Se connecter'}</button>
  </form></main>;
}
function Numeric({ value, onChange, min, max }: { value: number; onChange: (n: number) => void; min?: number; max?: number }) {
  return <input type="number" value={Number.isFinite(value) ? value : 0} min={min} max={max} onChange={e => onChange(Number(e.target.value))} />;
}
function AssetBrowser({ tiles }: { tiles: TileAsset[] }) {
  const tile = useEditor(s => s.tile), setTile = useEditor(s => s.setTile);
  const [type, setType] = useState<0 | 1 | 2>(0); const [pack, setPack] = useState(''); const [search, setSearch] = useState(''); const [scroll, setScroll] = useState(0);
  const packs = useMemo(() => [...new Set(tiles.filter(t => t.type === type).map(t => t.pack))].sort(), [tiles, type]);
  const filtered = useMemo(() => tiles.filter(t => t.type === type && (!pack || t.pack === pack) && (!search || String(t.id).includes(search))), [tiles, type, pack, search]);
  const start = Math.max(0, Math.floor(scroll / 92) - 2), end = Math.min(Math.ceil(filtered.length / 3), start + 12);
  return <section className="assets-panel"><div className="panel-title">Bibliothèque d’assets <span>{tiles.length}</span></div>
    <div className="segmented">{(['Sol', 'Objets', 'Fonds'] as const).map((label, i) => <button key={label} className={type === i ? 'active' : ''} onClick={() => { setType(i as 0 | 1 | 2); setPack(''); setScroll(0); }}>{label}</button>)}</div>
    <input aria-label="Rechercher un ID de tile" placeholder="Rechercher un ID…" value={search} onChange={e => { setSearch(e.target.value); setScroll(0); }} />
    <label className="field-label">Pack<select value={pack} onChange={e => { setPack(e.target.value); setScroll(0); }}><option value="">Tous les packs</option>{packs.map(p => <option key={p} value={p}>{p}</option>)}</select></label>
    <div className="asset-scroll" onScroll={e => setScroll(e.currentTarget.scrollTop)}>
      <div className="asset-virtual" style={{ height: `${Math.ceil(filtered.length / 3) * 92}px` }}>
        {filtered.slice(start * 3, end * 3).map((asset, index) => { const position = start * 3 + index; return <button key={`${asset.type}-${asset.id}`} className={`asset-card ${tile?.id === asset.id && tile.type === asset.type ? 'chosen' : ''}`}
          style={{ top: `${Math.floor(position / 3) * 92}px`, left: `${(position % 3) * 33.333}%` }} onClick={() => {
            if (asset.type === 2) useEditor.getState().mutate(map => { map.backgroundId = asset.id; }); else setTile(asset);
          }} title={`${asset.id} · ${asset.pack}`}><img loading="lazy" src={asset.url} alt="" /><span>{asset.id}</span></button>; })}
      </div>
    </div>
  </section>;
}
function CellInspector({ map, tiles }: { map: MapDocument; tiles: TileAsset[] }) {
  const selected = useEditor(s => s.selected), mutate = useEditor(s => s.mutate), layer = useEditor(s => s.layer), setLayer = useEditor(s => s.setLayer);
  const id = selected[0]; const cell = id === undefined ? null : map.cells[id];
  const [replaceId, setReplaceId] = useState(0);
  const tileIndex = useMemo(() => new Map(tiles.map(t => [`${t.type}-${t.id}`, t])), [tiles]);
  if (!cell) return <div className="empty-state">Sélectionnez une cellule sur la carte. Maj + clic sélectionne plusieurs cellules.</div>;
  const update = (fn: (cell: Cell) => void) => mutate(next => { for (const selectedId of selected) if (next.cells[selectedId]) fn(next.cells[selectedId]); });
  const key = `gfx${layer}` as 'gfx1' | 'gfx2' | 'gfx3';
  return <div className="inspector-content">
    <div className="cell-heading"><strong>Cellule #{id}</strong><span>{selected.length} sélectionnée{selected.length > 1 ? 's' : ''}</span></div>
    <div className="layer-cards">{([1, 2, 3] as Layer[]).map(n => { const graphic = cell[`gfx${n}` as 'gfx1' | 'gfx2' | 'gfx3']; const asset = graphic === null ? null : tileIndex.get(`${n === 1 ? 0 : 1}-${graphic}`); return <button key={n} className={`layer-card ${layer === n ? 'chosen' : ''}`} onClick={() => setLayer(n)}>
      <span>Gfx{n}</span>{asset ? <img src={asset.url} alt="" /> : <div className="tile-empty">◇</div>}<strong>{graphic ?? 'Vide'}</strong></button>; })}</div>
    <div className="button-row"><button onClick={() => update(cell => { cell[key] = null; })}>Supprimer Gfx{layer}</button><button onClick={() => {
      const current = cell[key]; if (current === null) return;
      mutate(next => next.cells.forEach(item => { if (item[key] === current) item[key] = null; }));
    }}>Suppr. partout</button></div>
    <div className="field-row"><label>Remplacer partout</label><Numeric value={replaceId} onChange={setReplaceId} min={0} max={16383} /><button onClick={() => {
      const current = cell[key]; if (current === null) return;
      mutate(next => next.cells.forEach(item => { if (item[key] === current) item[key] = replaceId; }));
    }}>Appliquer</button></div>
    <h3>Propriétés</h3>
    <div className="checks">{([['unWalkable', 'Infranchissable'], ['loS', 'Ligne de vue'], ['path', 'Chemin'], ['paddock', 'Enclos'], ['door', 'Porte'], ['triggerCell', 'Déclencheur'], ['io', 'Objet interactif']] as [CellFlag, string][]).map(([flag, label]) => <label key={flag}><input type="checkbox" checked={cell[flag]} onChange={e => update(c => { c[flag] = e.target.checked; if (flag === 'unWalkable' && e.target.checked) { c.fightCell = 0; c.path = false; c.paddock = false; } if (flag === 'triggerCell' && !e.target.checked) delete c.trigger; })} />{label}</label>)}</div>
    <div className="field-row"><label>Combat</label><select value={cell.fightCell} onChange={e => update(c => { c.fightCell = Number(e.target.value) as 0 | 1 | 2; })}><option value={0}>Aucun</option><option value={1}>Équipe 1</option><option value={2}>Équipe 2</option></select></div>
    <div className="two-fields"><label>Niveau du sol<Numeric value={cell.nivSol} min={0} max={15} onChange={n => update(c => { c.nivSol = n; })} /></label><label>Pente<Numeric value={cell.inclineSol} min={0} max={15} onChange={n => update(c => { c.inclineSol = n; })} /></label></div>
    {cell.triggerCell && <div className="two-fields"><label>Carte cible<Numeric value={cell.trigger?.mapId ?? 0} min={1} onChange={n => update(c => { c.trigger = { mapId: n, cellId: c.trigger?.cellId ?? 0 }; })} /></label><label>Cellule cible<Numeric value={cell.trigger?.cellId ?? 0} min={0} onChange={n => update(c => { c.trigger = { mapId: c.trigger?.mapId ?? 0, cellId: n }; })} /></label></div>}
    <label className="field-label">Données legacy (10 caractères)<input readOnly value={encodeCell(cell)} /></label>
  </div>;
}
function MapInspector({ map, areas, subareas, monsters }: { map: MapDocument; areas: { id: number; name: string; superarea: number }[]; subareas: { id: number; name: string; area: number; superarea: number }[]; monsters: { id: number; name: string }[] }) {
  const mutate = useEditor(s => s.mutate);
  const [versions, setVersions] = useState<{ version: number; author: string; savedAt: string }[]>([]);
  useEffect(() => { api.versions(map.id).then(setVersions).catch(() => {}); }, [map.id, map.version]);
  const set = <K extends keyof MapDocument>(key: K, value: MapDocument[K]) => mutate(next => { next[key] = value; });
  const geo = map.geoposition, combat = map.combat;
  return <div className="inspector-content">
    <h3>Carte #{map.id}</h3><div className="two-fields"><label>Largeur<input value={map.width} readOnly /></label><label>Hauteur<input value={map.height} readOnly /></label></div>
    <label className="field-label">Date / version du jeu<input value={map.dateMap} onChange={e => set('dateMap', e.target.value)} /></label>
    <div className="two-fields"><label>Musique<Numeric value={map.musicId} onChange={n => set('musicId', n)} min={0} /></label><label>Ambiance<Numeric value={map.ambianceId} onChange={n => set('ambianceId', n)} min={0} /></label></div>
    <label className="checkline"><input type="checkbox" checked={map.outdoor} onChange={e => set('outdoor', e.target.checked)} /> Extérieur</label>
    <label className="field-label">Capabilities<Numeric value={map.capabilities} onChange={n => set('capabilities', n)} min={0} /></label>
    <h3>Géoposition</h3><div className="two-fields"><label>X<Numeric value={geo.x} onChange={n => mutate(m => { m.geoposition.x = n; })} /></label><label>Y<Numeric value={geo.y} onChange={n => mutate(m => { m.geoposition.y = n; })} /></label></div>
    <label className="field-label">Zone<select value={geo.area} onChange={e => mutate(m => { const area = areas.find(a => a.id === Number(e.target.value)); const sub = subareas.find(s => s.area === area?.id); if (area && sub) { m.geoposition.area = area.id; m.geoposition.superArea = area.superarea; m.geoposition.subArea = sub.id; } })}>{areas.map(a => <option value={a.id} key={a.id}>{a.id} · {a.name}</option>)}</select></label>
    <label className="field-label">Sous-zone<select value={geo.subArea} onChange={e => mutate(m => { const sub = subareas.find(s => s.id === Number(e.target.value)); if (sub) { m.geoposition.subArea = sub.id; m.geoposition.area = sub.area; m.geoposition.superArea = sub.superarea; } })}>{subareas.filter(s => s.area === geo.area).map(a => <option value={a.id} key={a.id}>{a.id} · {a.name}</option>)}</select></label>
    <label className="field-label">Super-zone<input readOnly value={geo.superArea} /></label>
    <h3>Combat et monstres</h3><div className="two-fields"><label>Groupes<Numeric value={combat.nbGroups} onChange={n => mutate(m => { m.combat.nbGroups = n; })} min={0} /></label><label>Taille max<Numeric value={combat.groupMaxSize} onChange={n => mutate(m => { m.combat.groupMaxSize = n; })} min={0} /></label></div>
    <div className="two-fields"><label>Taille min<Numeric value={combat.minGroupSize} onChange={n => mutate(m => { m.combat.minGroupSize = n; })} min={0} /></label><label>Combats max<Numeric value={combat.maxFights} onChange={n => mutate(m => { m.combat.maxFights = n; })} min={0} max={127} /></label></div>
    <div className="two-fields"><label>Niveau min<Numeric value={combat.minGroupLevel} onChange={n => mutate(m => { m.combat.minGroupLevel = n; })} min={0} /></label><label>Niveau max<Numeric value={combat.maxGroupLevel} onChange={n => mutate(m => { m.combat.maxGroupLevel = n; })} min={0} /></label></div>
    <label className="field-label">Marchands max<Numeric value={combat.maxMerchants} onChange={n => mutate(m => { m.combat.maxMerchants = n; })} min={0} /></label>
    <label className="field-label">Monstres (format serveur)<textarea rows={3} value={combat.mobs} onChange={e => mutate(m => { m.combat.mobs = e.target.value; })} /></label>
    <details><summary>Catalogue des monstres ({monsters.length})</summary><div className="monster-list">{monsters.slice(0, 500).map(monster => <button key={monster.id} onClick={() => mutate(m => { m.combat.mobs = `${m.combat.mobs}${m.combat.mobs ? ';' : ''}${monster.id}`; })}>{monster.id} · {monster.name}</button>)}</div></details>
    <label className="field-label">Groupe fixe (format serveur)<textarea rows={2} value={combat.fixedMobs} onChange={e => mutate(m => { m.combat.fixedMobs = e.target.value; })} /></label>
    <label className="field-label">Cellule du groupe fixe<Numeric value={combat.fixedCell ?? 0} onChange={n => mutate(m => { m.combat.fixedCell = n; })} min={0} /></label>
    <button onClick={() => mutate(m => { m.combat.fixedCell = null; m.combat.fixedMobs = ''; })}>Effacer le groupe fixe</button>
    <h3>Fin de combat</h3><div className="two-fields"><label>Carte cible<Numeric value={map.nextRoom ?? 0} onChange={n => mutate(m => { m.nextRoom = n || null; })} min={0} /></label><label>Cellule cible<Numeric value={map.nextCell ?? 0} onChange={n => mutate(m => { m.nextCell = n; })} min={0} /></label></div><button onClick={() => mutate(m => { m.nextRoom = null; m.nextCell = null; })}>Effacer le lien</button>
    <h3>Assets utilisés</h3><p className="muted">{gfxUsed(map).length} IDs : {gfxUsed(map).slice(0, 40).join(', ')}{gfxUsed(map).length > 40 ? '…' : ''}</p>
    <details><summary>Historique serveur ({versions.length})</summary><div className="monster-list">{versions.map(item => <button key={item.version} onClick={async () => {
      if (!window.confirm(`Restaurer la version ${item.version} comme brouillon de la carte ?`)) return;
      try { const historical = await api.version(map.id, item.version); mutate(current => {
        const keep = { version: current.version, author: current.author, createdAt: current.createdAt, updatedAt: current.updatedAt };
        Object.assign(current, cloneMap(historical), keep);
      }); } catch (error) { window.alert(errText(error)); }
    }}>v{item.version} · {item.author}</button>)}</div></details>
  </div>;
}
function WorldEditor({ map, onNotice }: { map: MapDocument; onNotice: (message: string) => void }) {
  const [world, setWorld] = useState<{ id: number; x: number; y: number; area: number; subArea: number }[]>([]);
  const [origin, setOrigin] = useState({ x: map.geoposition.x - 7, y: map.geoposition.y - 5 });
  useEffect(() => { api.world().then(setWorld).catch(error => onNotice(errText(error))); }, [map.id]);
  const lookup = new Map(world.filter(m => m.area === map.geoposition.area).map(m => [`${m.x},${m.y}`, m]));
  const cells = Array.from({ length: 11 * 15 }, (_, i) => { const x = origin.x + i % 15, y = origin.y + Math.floor(i / 15); return { x, y, occupant: lookup.get(`${x},${y}`) }; });
  const exportPng = () => { const canvas = document.createElement('canvas'); canvas.width = 750; canvas.height = 550; const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#111c2a'; ctx.fillRect(0, 0, 750, 550); ctx.font = '12px sans-serif'; ctx.textAlign = 'center';
    cells.forEach((cell, i) => { const x = i % 15 * 50, y = Math.floor(i / 15) * 50; ctx.fillStyle = cell.occupant ? '#287e77' : '#243448'; ctx.fillRect(x + 1, y + 1, 48, 48); ctx.fillStyle = '#fff'; ctx.fillText(cell.occupant ? String(cell.occupant.id) : `${cell.x},${cell.y}`, x + 25, y + 27); });
    canvas.toBlob(blob => { if (!blob) return; const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `geoposition-area-${map.geoposition.area}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }); };
  return <div className="world-editor"><div className="world-toolbar"><span>Zone {map.geoposition.area} · cliquez une case pour placer la carte #{map.id}</span><button onClick={() => setOrigin({ x: origin.x - 1, y: origin.y })}>←</button><button onClick={() => setOrigin({ x: origin.x + 1, y: origin.y })}>→</button><button onClick={() => setOrigin({ x: origin.x, y: origin.y - 1 })}>↑</button><button onClick={() => setOrigin({ x: origin.x, y: origin.y + 1 })}>↓</button><button onClick={exportPng}>Exporter PNG</button></div>
    <div className="world-grid">{cells.map(cell => <button key={`${cell.x},${cell.y}`} className={`${cell.occupant ? 'occupied' : ''} ${cell.x === map.geoposition.x && cell.y === map.geoposition.y ? 'current' : ''}`}
      title={`${cell.x},${cell.y}${cell.occupant ? ` · map ${cell.occupant.id}` : ''}`} onClick={() => {
        if (cell.occupant && cell.occupant.id !== map.id && !window.confirm(`La carte ${cell.occupant.id} occupe déjà cette position. Continuer ?`)) return;
        useEditor.getState().mutate(m => { m.geoposition.x = cell.x; m.geoposition.y = cell.y; });
      }}>{cell.occupant ? `#${cell.occupant.id}` : `${cell.x},${cell.y}`}</button>)}</div>
  </div>;
}
export default function App() {
  const [user, setUser] = useState<{ sub: string; role: string } | null>(hasToken() ? { sub: 'session', role: 'editor' } : null);
  const [maps, setMaps] = useState<MapSummary[]>([]); const [legacy, setLegacy] = useState<{ id: number; dateMap: string }[]>([]);
  const [tiles, setTiles] = useState<TileAsset[]>([]); const [loadProgress, setLoadProgress] = useState('');
  const [areas, setAreas] = useState<{ id: number; name: string; superarea: number }[]>([]), [subareas, setSubareas] = useState<{ id: number; name: string; area: number; superarea: number }[]>([]), [monsters, setMonsters] = useState<{ id: number; name: string }[]>([]);
  const [notice, setNotice] = useState('Prêt.'); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [newId, setNewId] = useState(21001), [newWidth, setNewWidth] = useState(15), [newHeight, setNewHeight] = useState(17), [newSubArea, setNewSubArea] = useState<number | null>(null), [mapSearch, setMapSearch] = useState('');
  const [inspector, setInspector] = useState<'cell' | 'map' | 'world'>('cell');
  const [thumbnails, setThumbnails] = useState<Record<number, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const tabs = useEditor(s => s.tabs), activeId = useEditor(s => s.activeId), selected = useEditor(s => s.selected);
  const tool = useEditor(s => s.tool), paint = useEditor(s => s.paint), layer = useEditor(s => s.layer), brushSize = useEditor(s => s.brushSize);
  const rotation = useEditor(s => s.rotation), flip = useEditor(s => s.flip), views = useEditor(s => s.views), zoom = useEditor(s => s.zoom);
  const active = activeId === null ? null : tabs[activeId];
  const tileMap = useMemo(() => new Map(tiles.map(t => [t.type * 100000 + t.id, t])), [tiles]);
  const cache = useMemo(() => new ImageCache(() => window.dispatchEvent(new Event('astria-image-loaded'))), []);
  const refreshLists = useCallback(async () => { const [list, legacyList] = await Promise.all([api.maps(), api.legacyMaps(mapSearch)]); setMaps(list); setLegacy(legacyList); }, [mapSearch]);
  useEffect(() => { if (!user) return; const timer = setTimeout(() => { api.legacyMaps(mapSearch).then(setLegacy).catch(error => setError(errText(error))); }, 250); return () => clearTimeout(timer); }, [mapSearch, user?.sub]);
  useEffect(() => { if (hasToken()) api.me().then(setUser).catch(error => { if (error instanceof ApiError && error.status === 401) { setToken(''); setUser(null); } else setError(errText(error)); }); }, []);
  useEffect(() => { if (!user) return; let alive = true;
    refreshLists().catch(error => { if (error instanceof ApiError && error.status === 401) { setToken(''); setUser(null); } else setError(errText(error)); });
    fetchAllTiles((loaded, total) => { if (alive) setLoadProgress(`${loaded} / ${total} assets`); }).then(all => { if (alive) { setTiles(all); setLoadProgress(''); } }).catch(error => setError(errText(error)));
    Promise.all([api.areas(), api.subareas(), api.metadata('monsters')]).then(([a, s, m]) => { if (alive) { setAreas(a); setSubareas(s); setMonsters(m); setNewSubArea(current => current ?? s.find(item => item.id !== 0)?.id ?? null); } }).catch(() => {});
    return () => { alive = false; };
  }, [user?.sub]);
  useEffect(() => { if (!user) return; const timer = setInterval(() => { for (const tab of Object.values(useEditor.getState().tabs)) if (tab.dirty) putDraft(tab.map).catch(() => {}); }, 30000); return () => clearInterval(timer); }, [user]);
  useEffect(() => { const beforeUnload = (event: BeforeUnloadEvent) => { if (Object.values(useEditor.getState().tabs).some(tab => tab.dirty)) { event.preventDefault(); event.returnValue = ''; } }; window.addEventListener('beforeunload', beforeUnload); return () => window.removeEventListener('beforeunload', beforeUnload); }, []);
  useEffect(() => { if (!user) return; const timer = setInterval(() => { for (const [id, tab] of Object.entries(useEditor.getState().tabs)) if (tab.editable) api.lock(Number(id)).catch(error => { useEditor.getState().setEditable(Number(id), false); setError(`Verrou perdu pour la carte ${id}: ${errText(error)}`); }); }, 60000); return () => clearInterval(timer); }, [user]);
  useEffect(() => { const handler = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.closest('input,textarea,select')) return;
    const s = useEditor.getState();
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? s.redo() : s.undo(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); s.redo(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') { e.preventDefault(); s.copy(); setNotice('Cellules copiées.'); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') { e.preventDefault(); s.paste(s.selected[0] ?? s.hovered ?? 0); }
    else if (e.key.toLowerCase() === 'f') s.toggleFlip(); else if (e.key.toLowerCase() === 'r') s.rotate();
    else if (e.key === 'Delete' && s.selected.length) s.mutate(map => s.selected.forEach(id => { map.cells[id][`gfx${s.layer}` as 'gfx1' | 'gfx2' | 'gfx3'] = null; }));
    else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key) && s.activeId !== null) {
      e.preventDefault(); const map = s.tabs[s.activeId].map, stride = map.width * 2 - 1, current = s.selected.at(-1) ?? 0;
      const delta = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' ? -stride : stride;
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? map.cells.length - 1 : Math.max(0, Math.min(map.cells.length - 1, current + delta));
      s.select(next, e.shiftKey);
    }
    else if (e.key === 'Escape') s.setLinkStart(null);
  }; window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler); }, []);
  useEffect(() => { if (!user || !maps.length) return; let canceled = false;
    Promise.all(maps.slice(0, 60).map(async map => { try { const res = await fetch(map.thumbnailUrl, { headers: { Authorization: `Bearer ${getToken()}` } }); if (!res.ok) return null; return [map.id, URL.createObjectURL(await res.blob())] as const; } catch { return null; } })).then(items => { if (canceled) { items.forEach(item => item && URL.revokeObjectURL(item[1])); return; } setThumbnails(Object.fromEntries(items.filter((item): item is readonly [number, string] => item !== null))); });
    return () => { canceled = true; };
  }, [maps, user]);
  useEffect(() => () => { Object.values(thumbnails).forEach(URL.revokeObjectURL); }, [thumbnails]);
  const openMap = async (id: number, supplied?: MapDocument, alreadyLocked = false) => {
    if (useEditor.getState().tabs[id]) { useEditor.getState().activate(id); return; }
    setBusy(true); setError('');
    try {
      const map = supplied ?? await api.map(id); let editable = alreadyLocked;
      if (!alreadyLocked) { try { await api.lock(id); editable = true; } catch (error) { if (error instanceof ApiError && error.status === 423) setNotice(errText(error)); else throw error; } }
      const draft = await getDraft(id).catch(() => null);
      const restored = editable && draft && draft.map.version === map.version && draft.savedAt > Date.parse(map.updatedAt) && window.confirm('Un brouillon local existe pour cette carte. Le restaurer ?') ? draft.map : map;
      useEditor.getState().open(restored, editable);
      if (restored !== map) useEditor.setState(state => ({ tabs: { ...state.tabs, [id]: { ...state.tabs[id], dirty: true } } }));
      setNotice(`Carte ${id} ouverte${editable ? '' : ' en lecture seule'}.`);
    } catch (error) { setError(errText(error)); } finally { setBusy(false); }
  };
  const create = async () => { setBusy(true); setError(''); try { if (newSubArea === null) throw new Error('Choisissez une sous-zone.'); const map = await api.create(newId, newWidth, newHeight, newSubArea); await refreshLists(); await openMap(map.id, map, true); } catch (error) { setError(errText(error)); } finally { setBusy(false); } };
  const save = async () => {
    if (!active || !active.editable) return;
    const errors = validateMap(active.map); if (errors.length) { setError(errors.slice(0, 6).join('; ')); return; }
    setBusy(true); setError('');
    try {
      const urls = [...new Set([active.map.backgroundId === null ? null : tileMap.get(200000 + active.map.backgroundId)?.url,
        ...active.map.cells.flatMap(c => [c.gfx1 === null ? null : tileMap.get(c.gfx1)?.url, c.gfx2 === null ? null : tileMap.get(100000 + c.gfx2)?.url, c.gfx3 === null ? null : tileMap.get(100000 + c.gfx3)?.url])].filter((x): x is string => Boolean(x)))];
      await cache.preload(urls);
      const saved = await api.save(active.map, makeThumbnail(active.map, views, tileMap, cache), makeCellThumbnail(active.map, tileMap, cache));
      useEditor.getState().replaceSaved(saved); await deleteDraft(saved.id); await refreshLists(); setNotice(`Carte ${saved.id} enregistrée · version ${saved.version}.`);
    } catch (error) { setError(errText(error)); if (error instanceof ApiError && (error.status === 409 || error.status === 423)) { await putDraft(active.map).catch(() => {}); setNotice('Brouillon local conservé. Exportez le JSON avant de recharger.'); } }
    finally { setBusy(false); }
  };
  const close = async (id: number) => { const tab = useEditor.getState().tabs[id]; if (!tab) return;
    if (tab.dirty && !window.confirm(`Fermer la carte ${id} avec des modifications non enregistrées ? Un brouillon local sera conservé.`)) return;
    if (tab.dirty) await putDraft(tab.map).catch(() => {});
    api.unlock(id).catch(() => {}); useEditor.getState().close(id);
  };
  const importFile = async (file: File) => { setBusy(true); setError(''); try {
    if (file.name.toLowerCase().endsWith('.ame')) throw new Error('Le format binaire .ame ne peut pas être importé directement. Exportez-le depuis l’éditeur Windows vers la base, puis utilisez « Importer depuis MySQL ».');
    let map: MapDocument;
    if (file.name.toLowerCase().endsWith('.swf')) {
      const bytes = new Uint8Array(await file.arrayBuffer()); let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
      map = await api.decodeSwf(btoa(binary), file.name);
    } else map = JSON.parse(await file.text()) as MapDocument;
    const errors = validateMap(map); if (errors.length) throw new Error(errors.join('; '));
    const subArea = map.geoposition.subArea || newSubArea; if (subArea === null) throw new Error('Choisissez une sous-zone.');
    const created = await api.create(map.id, map.width, map.height, subArea); const imported = cloneMap(map); imported.version = created.version; imported.createdAt = created.createdAt; imported.sourceHash = created.sourceHash;
    if (!map.geoposition.subArea) imported.geoposition = created.geoposition;
    useEditor.getState().open(imported, true); useEditor.setState(state => ({ tabs: { ...state.tabs, [map.id]: { ...state.tabs[map.id], dirty: true } } })); await putDraft(imported); await refreshLists(); setNotice(`Projet JSON ${map.id} importé. Enregistrez pour le publier.`);
  } catch (error) { setError(errText(error)); } finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; } };
  if (!user) return <Login onLogin={setUser} />;
  return <div className="app-shell">
    <header className="topbar"><div className="brand"><div className="brand-mark">◈</div><div><strong>Astria Map Studio</strong><small>Éditeur isométrique</small></div></div>
      <div className="top-actions"><span className="user-pill">{user.sub}</span><button onClick={async () => { for (const [id, tab] of Object.entries(useEditor.getState().tabs)) { if (tab.dirty) await putDraft(tab.map).catch(() => {}); await api.unlock(Number(id)).catch(() => {}); } setToken(''); setUser(null); useEditor.setState({ tabs: {}, activeId: null }); }}>Déconnexion</button></div></header>
    <div className="workspace">
      <aside className="left-sidebar"><div className="panel-title">Cartes <span>{maps.length}</span></div>
        <input placeholder="Rechercher une carte…" aria-label="Rechercher une carte" value={mapSearch} onChange={e => setMapSearch(e.target.value)} />
        <div className="map-list">{maps.filter(m => `${m.id} ${m.dateMap}`.toLowerCase().includes(mapSearch.toLowerCase())).map(summary => <button key={summary.id} className={`map-list-item ${activeId === summary.id ? 'active' : ''}`} onClick={() => openMap(summary.id)}>
          {thumbnails[summary.id] ? <img src={thumbnails[summary.id]} alt="" /> : <div className="map-placeholder">◇</div>}
          <span><strong>Carte #{summary.id}</strong><small>{summary.dateMap} · v{summary.version}</small></span></button>)}</div>
        <div className="new-map"><h3>Nouvelle carte</h3><div className="new-map-inputs"><label>ID<Numeric value={newId} onChange={setNewId} min={1} max={32767} /></label><label>L<Numeric value={newWidth} onChange={setNewWidth} min={2} max={100} /></label><label>H<Numeric value={newHeight} onChange={setNewHeight} min={2} max={100} /></label></div><label className="field-label">Sous-zone<select value={newSubArea ?? ''} onChange={e => setNewSubArea(Number(e.target.value))}>{subareas.map(s => <option key={s.id} value={s.id}>{s.id} · {s.name}</option>)}</select></label><button className="primary" disabled={busy || newSubArea === null} onClick={create}>Créer la carte</button></div>
        <details className="legacy-list"><summary>Importer depuis MySQL ({legacy.length} résultats)</summary>{legacy.map(m => <button key={m.id} onClick={async () => { setBusy(true); try { const map = await api.importLegacy(m.id); await refreshLists(); await openMap(map.id, map, true); } catch (error) { setError(errText(error)); } finally { setBusy(false); } }}>#{m.id} · {m.dateMap}</button>)}</details>
        <input ref={fileRef} type="file" accept=".json,.ame,.swf,application/json" hidden onChange={e => { const file = e.target.files?.[0]; if (file) importFile(file); }} />
        <button className="import-btn" onClick={() => fileRef.current?.click()}>Importer JSON ou SWF</button>
      </aside>
      <main className="main-area"><div className="tabbar">{Object.entries(tabs).map(([id, tab]) => <div key={id} className={`tab ${activeId === Number(id) ? 'active' : ''}`}><button onClick={() => useEditor.getState().activate(Number(id))}>◇ Carte {id}{tab.dirty ? ' •' : ''}{!tab.editable ? ' 🔒' : ''}</button><button className="tab-close" aria-label={`Fermer la carte ${id}`} onClick={() => close(Number(id))}>×</button></div>)}</div>
        {active ? <><div className="toolbar"><div className="tool-group"><button className={tool === 'selector' ? 'selected' : ''} onClick={() => useEditor.getState().setTool('selector')}>Sélection</button><button className={tool === 'brush' ? 'selected' : ''} onClick={() => useEditor.getState().setTool('brush')}>Pinceau</button><button className={tool === 'cell' ? 'selected' : ''} onClick={() => useEditor.getState().setTool('cell')}>Cellules</button><button className={tool === 'trigger' ? 'selected' : ''} onClick={() => useEditor.getState().setTool('trigger')}>Déclencheur</button><button className={tool === 'endFight' ? 'selected' : ''} onClick={() => useEditor.getState().setTool('endFight')}>Fin combat</button></div>
          <div className="tool-group"><button onClick={() => useEditor.getState().undo()} title="Ctrl+Z">↶</button><button onClick={() => useEditor.getState().redo()} title="Ctrl+Y">↷</button><button className="primary" disabled={busy || !active.editable} onClick={save}>Enregistrer</button></div></div>
          <div className="subtoolbar"><label>Calque <select value={layer} onChange={e => useEditor.getState().setLayer(Number(e.target.value) as Layer)}><option value={1}>Sol</option><option value={2}>Objet 1</option><option value={3}>Objet 2</option></select></label>
            {tool === 'cell' && <label>Type <select value={paint} onChange={e => useEditor.getState().setPaint(e.target.value as typeof paint)}><option value="unWalkable">Infranchissable</option><option value="loS">Bloque LoS</option><option value="path">Chemin</option><option value="paddock">Enclos</option><option value="fight1">Combat 1</option><option value="fight2">Combat 2</option></select></label>}
            <label>Taille <select value={brushSize} onChange={e => useEditor.getState().setBrushSize(Number(e.target.value))}><option value={1}>1</option><option value={2}>2</option><option value={3}>3</option><option value={5}>5</option></select></label>
            <button onClick={() => useEditor.getState().rotate()} title="R">Rotation {rotation * 90}°</button><button className={flip ? 'selected' : ''} onClick={() => useEditor.getState().toggleFlip()} title="F">Miroir</button>
            <div className="spacer" /><button onClick={() => useEditor.getState().setZoom(zoom / 1.2)}>−</button><span>{Math.round(zoom * 100)}%</span><button onClick={() => useEditor.getState().setZoom(zoom * 1.2)}>+</button></div>
          <div className="viewbar">{([['background', 'Fond'], ['ground', 'Sol'], ['layer2', 'Objets 1'], ['layer3', 'Objets 2'], ['grid', 'Grille'], ['ids', 'IDs'], ['cellMode', 'Mode cellules']] as [keyof typeof views, string][]).map(([key, label]) => <label key={key}><input type="checkbox" checked={views[key]} onChange={() => useEditor.getState().setView(key)} />{label}</label>)}</div>
          <div className="stage"><MapCanvas map={active.map} tiles={tileMap} cache={cache} onNotice={setNotice} /></div>
          <div className="stage-footer"><span>Carte #{active.map.id} · {active.map.width} × {active.map.height} · {active.map.cells.length} cellules</span><span>{active.editable ? 'Édition active' : 'Lecture seule'} · {selected.length ? `cellule ${selected.join(', ')}` : 'aucune sélection'}</span><div className="spacer" /><button onClick={() => downloadText(`${active.map.id}.astria.json`, JSON.stringify(active.map, null, 2))}>Exporter JSON</button><button onClick={async () => { const response = await fetch(`/api/maps/${active.map.id}/legacy-sql`, { headers: { Authorization: `Bearer ${getToken()}` } }); if (response.ok) downloadText(`${active.map.id}.sql`, await response.text(), 'text/plain'); else setError('Export SQL impossible.'); }}>Exporter SQL</button></div>
        </> : <div className="welcome"><div className="welcome-icon">◈</div><h1>Construisez votre monde</h1><p>Créez une carte ou ouvrez un projet depuis la barre latérale.</p><div className="welcome-hints"><span>◇ Dessin isométrique</span><span>▦ Calques et cellules</span><span>↶ Historique</span></div></div>}
      </main>
      <aside className="right-sidebar">{active ? <><div className="inspector-tabs"><button className={inspector === 'cell' ? 'active' : ''} onClick={() => setInspector('cell')}>Cellule</button><button className={inspector === 'map' ? 'active' : ''} onClick={() => setInspector('map')}>Carte</button><button className={inspector === 'world' ? 'active' : ''} onClick={() => setInspector('world')}>Monde</button></div>
        {inspector === 'cell' ? <CellInspector map={active.map} tiles={tiles} /> : inspector === 'map' ? <MapInspector map={active.map} areas={areas} subareas={subareas} monsters={monsters} /> : <WorldEditor map={active.map} onNotice={setNotice} />}
      </> : <div className="inspector-content"><div className="panel-title">Inspecteur</div><p className="muted">Les propriétés de la carte et des cellules apparaîtront ici.</p></div>}
        <AssetBrowser tiles={tiles} /></aside>
    </div>
    <footer className="statusbar"><span className="status-dot" />{error ? <span className="error-text" role="alert">{error}</span> : notice}<div className="spacer" />{loadProgress && <span>{loadProgress}</span>}<span>{busy ? 'Opération en cours…' : 'Prêt'}</span></footer>
  </div>;
}
