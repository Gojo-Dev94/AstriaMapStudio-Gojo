import { useCallback, useEffect, useRef, useState } from 'react';
import { CELL_HALF, cellPosition, type MapDocument, type TileAsset } from './domain.ts';
import { ImageCache, pickCell, renderMap } from './render.ts';
import { useEditor } from './store.ts';

interface Props { map: MapDocument; tiles: Map<number, TileAsset>; cache: ImageCache; onNotice: (message: string) => void }
export function MapCanvas({ map, tiles, cache, onNotice }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 600, height: 500 });
  const [imagesChanged, setImagesChanged] = useState(0);
  const selected = useEditor(s => s.selected);
  const hovered = useEditor(s => s.hovered);
  const views = useEditor(s => s.views);
  const tool = useEditor(s => s.tool);
  const brushSize = useEditor(s => s.brushSize);
  const zoom = useEditor(s => s.zoom);
  const pan = useEditor(s => s.pan);
  const linkStart = useEditor(s => s.linkStart);
  const drag = useRef<{ mode: 'paint' | 'pan'; lastX: number; lastY: number; seen: Set<number>; remove: boolean } | null>(null);
  useEffect(() => {
    const el = canvasRef.current?.parentElement; if (!el) return;
    const observer = new ResizeObserver(() => setSize({ width: el.clientWidth, height: el.clientHeight }));
    observer.observe(el); setSize({ width: el.clientWidth, height: el.clientHeight }); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const canvas = canvasRef.current; const ctx = canvas?.getContext('2d'); if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(size.width * dpr)); canvas.height = Math.max(1, Math.floor(size.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = '#101923'; ctx.fillRect(0, 0, size.width, size.height);
    ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * pan.x, dpr * pan.y);
    renderMap(ctx, map, { ...views, cellMode: views.cellMode || tool === 'cell' }, tiles, cache, selected, hovered,
      { x: -pan.x / zoom, y: -pan.y / zoom, width: size.width / zoom, height: size.height / zoom });
  }, [map, size, views, tool, tiles, selected, hovered, zoom, pan, imagesChanged, cache]);
  useEffect(() => { const onLoad = () => setImagesChanged(n => n + 1); window.addEventListener('astria-image-loaded', onLoad); return () => window.removeEventListener('astria-image-loaded', onLoad); }, []);
  const atEvent = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left - pan.x) / zoom, y = (event.clientY - rect.top - pan.y) / zoom;
    return { id: pickCell(map, x, y), x, y };
  }, [map, pan, zoom]);
  const paintAt = useCallback((id: number, remove: boolean) => {
    const state = useEditor.getState();
    const seen = drag.current?.seen;
    if (seen?.has(id)) return;
    const center = cellPosition(id, map.width);
    const radius = brushSize === 1 ? 0 : (brushSize - 0.5) * CELL_HALF * 2;
    const ids = brushSize === 1 ? [id] : map.cells.filter(cell => {
      const p = cellPosition(cell.id, map.width);
      return Math.hypot((p.x - center.x), (p.y - center.y) * 2) <= radius;
    }).map(cell => cell.id);
    ids.forEach(cellId => seen?.add(cellId)); state.paintCells(ids, remove);
  }, [map, brushSize]);
  const handleLink = (id: number) => {
    const state = useEditor.getState();
    if (!linkStart) { if (!state.tabs[map.id]?.editable) { onNotice('Carte source en lecture seule.'); return; } state.setLinkStart({ mapId: map.id, cellId: id }); onNotice(`Source ${map.id}:${id} sélectionnée. Cliquez la cellule de destination.`); return; }
    if (!state.tabs[linkStart.mapId]?.editable) { state.setLinkStart(null); onNotice('Le verrou de la carte source a expiré.'); return; }
    if (tool === 'endFight' && linkStart.mapId === map.id) { onNotice('La destination de fin de combat doit être sur une autre carte.'); return; }
    state.mutateId(linkStart.mapId, source => {
      if (tool === 'trigger') { source.cells[linkStart.cellId].triggerCell = true; source.cells[linkStart.cellId].trigger = { mapId: map.id, cellId: id }; }
      else { source.nextRoom = map.id; source.nextCell = id; }
    });
    state.setLinkStart(null); onNotice(`Lien créé : ${linkStart.mapId}:${linkStart.cellId} → ${map.id}:${id}`);
  };
  return <canvas ref={canvasRef} className="map-canvas" role="img" aria-label={`Carte isométrique ${map.id}. Utilisez l'inspecteur pour modifier les cellules au clavier.`}
    onContextMenu={event => event.preventDefault()}
    onPointerDown={event => {
      const { id } = atEvent(event);
      if (event.button === 1 || event.altKey) { drag.current = { mode: 'pan', lastX: event.clientX, lastY: event.clientY, seen: new Set(), remove: false }; event.currentTarget.setPointerCapture(event.pointerId); return; }
      if (id === null) return;
      if (tool === 'selector') { useEditor.getState().select(id, event.shiftKey); return; }
      if (tool === 'trigger' || tool === 'endFight') { handleLink(id); return; }
      if (event.button !== 0 && event.button !== 2) return;
      if (!useEditor.getState().tabs[map.id]?.editable) { onNotice('Carte en lecture seule : verrou détenu par un autre éditeur.'); return; }
      drag.current = { mode: 'paint', lastX: event.clientX, lastY: event.clientY, seen: new Set(), remove: event.button === 2 };
      useEditor.getState().startStroke(); paintAt(id, event.button === 2); event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={event => {
      if (drag.current?.mode === 'pan') {
        const dx = event.clientX - drag.current.lastX, dy = event.clientY - drag.current.lastY;
        drag.current.lastX = event.clientX; drag.current.lastY = event.clientY;
        useEditor.getState().setPan(useEditor.getState().pan.x + dx, useEditor.getState().pan.y + dy); return;
      }
      const { id } = atEvent(event);
      if (hovered !== id) useEditor.getState().setHover(id);
      if (drag.current?.mode === 'paint' && id !== null) paintAt(id, drag.current.remove);
    }}
    onPointerUp={() => { if (drag.current?.mode === 'paint') useEditor.getState().endStroke(); drag.current = null; }}
    onPointerCancel={() => { if (drag.current?.mode === 'paint') useEditor.getState().endStroke(); drag.current = null; }}
    onPointerLeave={() => useEditor.getState().setHover(null)}
    onWheel={event => {
      event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect();
      const x = event.clientX - rect.left, y = event.clientY - rect.top;
      const next = Math.max(.35, Math.min(4, zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1)));
      useEditor.getState().setPan(x - (x - pan.x) * next / zoom, y - (y - pan.y) * next / zoom);
      useEditor.getState().setZoom(next);
    }} />;
}
