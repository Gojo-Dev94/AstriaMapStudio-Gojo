import { create } from 'zustand';
import { cloneMap, type Cell, type CellFlag, type FightTeam, type Layer, type MapDocument, type TileAsset } from './domain.ts';
type Tool = 'brush' | 'selector' | 'cell' | 'trigger' | 'endFight';
type Paint = 'unWalkable' | 'loS' | 'path' | 'paddock' | 'fight1' | 'fight2';
type Views = { background: boolean; ground: boolean; layer2: boolean; layer3: boolean; grid: boolean; ids: boolean; cellMode: boolean };
type Tab = { map: MapDocument; dirty: boolean; editable: boolean; undo: MapDocument[]; redo: MapDocument[] };
type LinkStart = { mapId: number; cellId: number };
interface EditorState {
  tabs: Record<number, Tab>; activeId: number | null; selected: number[]; hovered: number | null;
  tool: Tool; paint: Paint; layer: Layer; tile: TileAsset | null; brushSize: number; rotation: number; flip: boolean;
  views: Views; zoom: number; pan: { x: number; y: number }; linkStart: LinkStart | null;
  clipboard: { anchor: number; cells: Cell[] } | null; strokeBefore: MapDocument | null;
  open: (map: MapDocument, editable: boolean) => void; close: (id: number) => void; activate: (id: number) => void;
  replaceSaved: (map: MapDocument) => void; setEditable: (id: number, editable: boolean) => void;
  mutate: (fn: (map: MapDocument) => void) => void; startStroke: () => void; stroke: (fn: (map: MapDocument) => void) => void; endStroke: () => void;
  mutateId: (id: number, fn: (map: MapDocument) => void) => void;
  undo: () => void; redo: () => void; select: (id: number, multi: boolean) => void;
  setHover: (id: number | null) => void; setTool: (tool: Tool) => void; setPaint: (paint: Paint) => void;
  setLayer: (layer: Layer) => void; setTile: (tile: TileAsset | null) => void;
  setBrushSize: (n: number) => void; rotate: () => void; toggleFlip: () => void;
  setView: (key: keyof Views) => void; setZoom: (zoom: number) => void; setPan: (x: number, y: number) => void;
  setLinkStart: (start: LinkStart | null) => void; copy: () => void; paste: (target: number) => void;
  paintCells: (ids: number[], remove?: boolean) => void;
}
const initialViews: Views = { background: true, ground: true, layer2: true, layer3: true, grid: true, ids: false, cellMode: false };
const tabChange = (state: EditorState, fn: (map: MapDocument) => void, history = true): Partial<EditorState> => {
  if (state.activeId === null) return {};
  const tab = state.tabs[state.activeId];
  if (!tab?.editable) return {};
  const next = cloneMap(tab.map); fn(next);
  if (JSON.stringify(next) === JSON.stringify(tab.map)) return {};
  return { tabs: { ...state.tabs, [state.activeId]: { ...tab, map: next, dirty: true,
    undo: history ? [...tab.undo, tab.map].slice(-50) : tab.undo, redo: history ? [] : tab.redo } } };
};
export const useEditor = create<EditorState>((set, get) => ({
  tabs: {}, activeId: null, selected: [], hovered: null, tool: 'selector', paint: 'unWalkable', layer: 1,
  tile: null, brushSize: 1, rotation: 0, flip: false, views: initialViews, zoom: 1, pan: { x: 20, y: 20 },
  linkStart: null, clipboard: null, strokeBefore: null,
  open: (map, editable) => set(s => ({ tabs: { ...s.tabs, [map.id]: { map, editable, dirty: false, undo: [], redo: [] } }, activeId: map.id, selected: [], pan: { x: 20, y: 20 }, zoom: 1 })),
  close: id => set(s => { const tabs = { ...s.tabs }; delete tabs[id]; return { tabs, activeId: s.activeId === id ? Number(Object.keys(tabs)[0]) || null : s.activeId, selected: [], linkStart: null }; }),
  activate: id => set({ activeId: id, selected: [] }),
  replaceSaved: map => set(s => { const tab = s.tabs[map.id]; return tab ? { tabs: { ...s.tabs, [map.id]: { ...tab, map, dirty: false, undo: [], redo: [] } } } : {}; }),
  setEditable: (id, editable) => set(s => ({ tabs: { ...s.tabs, [id]: { ...s.tabs[id], editable } } })),
  mutate: fn => set(s => tabChange(s, fn)),
  mutateId: (id, fn) => set(s => tabChange({ ...s, activeId: id }, fn)),
  startStroke: () => set(s => { const map = s.activeId === null ? null : s.tabs[s.activeId]?.map; return { strokeBefore: map ? cloneMap(map) : null }; }),
  stroke: fn => set(s => tabChange(s, fn, false)),
  endStroke: () => set(s => {
    if (s.activeId === null || !s.strokeBefore) return { strokeBefore: null };
    const tab = s.tabs[s.activeId];
    if (JSON.stringify(tab.map) === JSON.stringify(s.strokeBefore)) return { strokeBefore: null };
    return { strokeBefore: null, tabs: { ...s.tabs, [s.activeId]: { ...tab, undo: [...tab.undo, s.strokeBefore].slice(-50), redo: [] } } };
  }),
  undo: () => set(s => {
    if (s.activeId === null) return {}; const tab = s.tabs[s.activeId]; if (!tab?.editable || !tab.undo.length) return {};
    return { tabs: { ...s.tabs, [s.activeId]: { ...tab, map: tab.undo.at(-1)!, undo: tab.undo.slice(0, -1), redo: [...tab.redo, tab.map], dirty: true } } };
  }),
  redo: () => set(s => {
    if (s.activeId === null) return {}; const tab = s.tabs[s.activeId]; if (!tab?.editable || !tab.redo.length) return {};
    return { tabs: { ...s.tabs, [s.activeId]: { ...tab, map: tab.redo.at(-1)!, undo: [...tab.undo, tab.map], redo: tab.redo.slice(0, -1), dirty: true } } };
  }),
  select: (id, multi) => set(s => ({ selected: multi ? (s.selected.includes(id) ? s.selected.filter(x => x !== id) : [...s.selected, id]) : [id] })),
  setHover: hovered => set({ hovered }), setTool: tool => set({ tool, linkStart: null }), setPaint: paint => set({ paint }),
  setLayer: layer => set(s => ({ layer, tile: s.tile && (s.tile.type === 0 ? layer !== 1 : layer === 1) ? null : s.tile })),
  setTile: tile => set({ tile, tool: 'brush', layer: tile?.type === 0 ? 1 : get().layer === 1 ? 2 : get().layer }),
  setBrushSize: brushSize => set({ brushSize }), rotate: () => set(s => ({ rotation: (s.rotation + 1) % 4 })), toggleFlip: () => set(s => ({ flip: !s.flip })),
  setView: key => set(s => ({ views: { ...s.views, [key]: !s.views[key] } })),
  setZoom: zoom => set({ zoom: Math.max(0.35, Math.min(4, zoom)) }), setPan: (x, y) => set({ pan: { x, y } }),
  setLinkStart: linkStart => set({ linkStart }),
  copy: () => set(s => { const map = s.activeId === null ? null : s.tabs[s.activeId]?.map; const ids = [...s.selected].sort((a, b) => a - b); return map && ids.length ? { clipboard: { anchor: ids[0], cells: ids.map(id => structuredClone(map.cells[id])) } } : {}; }),
  paste: target => {
    const { clipboard, activeId, tabs } = get(); if (!clipboard || activeId === null) return;
    const ids = clipboard.cells.map(cell => target + cell.id - clipboard.anchor).filter(id => id >= 0 && id < tabs[activeId].map.cells.length);
    get().mutate(map => clipboard.cells.forEach((cell, index) => { const id = target + cell.id - clipboard.anchor; if (ids.includes(id)) map.cells[id] = { ...structuredClone(cell), id }; }));
  },
  paintCells: (ids, remove = false) => {
    const s = get();
    s.stroke(map => ids.forEach(id => {
      const cell = map.cells[id]; if (!cell) return;
      if (s.tool === 'brush') {
        if (!s.tile || s.tile.type === 0 && s.layer !== 1 || s.tile.type === 1 && s.layer === 1) return;
        const key = `gfx${s.layer}` as 'gfx1' | 'gfx2' | 'gfx3';
        cell[key] = remove ? null : s.tile.id;
        cell.rotation[s.layer - 1] = s.rotation; cell.flip[s.layer - 1] = s.flip;
      } else if (s.tool === 'cell') {
        const paint = s.paint;
        if (paint === 'fight1' || paint === 'fight2') { if (!cell.unWalkable) cell.fightCell = remove ? 0 : (paint === 'fight1' ? 1 : 2); }
        else if (paint === 'loS') cell.loS = remove;
        else {
          cell[paint as CellFlag] = !remove;
          if (paint === 'unWalkable' && !remove) { cell.fightCell = 0; cell.path = false; cell.paddock = false; }
        }
      }
    }));
  },
}));
