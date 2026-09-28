import { CELL_HALF, cellPosition, type MapDocument, type TileAsset } from './domain.ts';
export interface ViewOptions { background: boolean; ground: boolean; layer2: boolean; layer3: boolean; grid: boolean; ids: boolean; cellMode: boolean }
export class ImageCache {
  private images = new Map<string, HTMLImageElement>();
  constructor(private invalidate: () => void) {}
  get(url: string): HTMLImageElement | null {
    let image = this.images.get(url);
    if (!image) { image = new Image(); if (/^https?:\/\//.test(url)) image.crossOrigin = 'anonymous'; image.onload = this.invalidate; image.onerror = this.invalidate; image.src = url; this.images.set(url, image); }
    return image.complete && image.naturalWidth ? image : null;
  }
  async preload(urls: string[]): Promise<void> {
    await Promise.all(urls.map(url => new Promise<void>(resolve => {
      this.get(url);
      const image = this.images.get(url)!;
      if (image.complete) { resolve(); return; }
      image.addEventListener('load', () => resolve(), { once: true });
      image.addEventListener('error', () => resolve(), { once: true });
    })));
  }
}
function diamond(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.beginPath(); ctx.moveTo(x, y - CELL_HALF / 2); ctx.lineTo(x + CELL_HALF, y);
  ctx.lineTo(x, y + CELL_HALF / 2); ctx.lineTo(x - CELL_HALF, y); ctx.closePath();
}
function drawTile(ctx: CanvasRenderingContext2D, tile: TileAsset | undefined, x: number, y: number, rotation: number, flip: boolean, cache: ImageCache) {
  if (!tile) return;
  const image = cache.get(tile.url);
  if (!image) return;
  const ox = tile.x || image.width / 2, oy = tile.y || image.height / 2;
  ctx.save(); ctx.translate(x, y); ctx.rotate(rotation * Math.PI / 2); ctx.scale(flip ? -1 : 1, 1);
  ctx.drawImage(image, -ox, -oy); ctx.restore();
}
export function renderMap(ctx: CanvasRenderingContext2D, map: MapDocument, views: ViewOptions,
  tiles: Map<number, TileAsset>, cache: ImageCache, selected: number[] = [], hovered: number | null = null,
  viewport?: { x: number; y: number; width: number; height: number }) {
  const width = map.width * CELL_HALF * 2, height = map.height * CELL_HALF;
  ctx.fillStyle = '#111c2a'; ctx.fillRect(0, 0, width, height);
  if (views.background && map.backgroundId !== null) {
    const bg = tiles.get(2 * 100000 + map.backgroundId);
    if (bg) { const image = cache.get(bg.url); if (image) ctx.drawImage(image, 0, 0, width, height); }
  }
  const visible = map.cells.filter(cell => {
    if (!viewport) return true;
    const p = cellPosition(cell.id, map.width);
    return p.x >= viewport.x - 220 && p.x <= viewport.x + viewport.width + 220 && p.y >= viewport.y - 220 && p.y <= viewport.y + viewport.height + 220;
  });
  if (views.ground) for (const cell of visible) {
    const p = cellPosition(cell.id, map.width);
    if (cell.gfx1 !== null) drawTile(ctx, tiles.get(cell.gfx1), p.x, p.y, cell.rotation[0], cell.flip[0], cache);
    else { diamond(ctx, p.x, p.y); ctx.fillStyle = cell.unWalkable ? '#283648' : '#304a51'; ctx.fill(); }
  }
  if (views.layer2) for (const cell of visible) if (cell.gfx2 !== null) {
    const p = cellPosition(cell.id, map.width); drawTile(ctx, tiles.get(100000 + cell.gfx2), p.x, p.y, cell.rotation[1], cell.flip[1], cache);
  }
  if (views.layer3) for (const cell of visible) if (cell.gfx3 !== null) {
    const p = cellPosition(cell.id, map.width); drawTile(ctx, tiles.get(100000 + cell.gfx3), p.x, p.y, cell.rotation[2], cell.flip[2], cache);
  }
  for (const cell of visible) {
    const p = cellPosition(cell.id, map.width);
    if (views.cellMode) {
      let color = cell.unWalkable ? '#ef535060' : '#46c69a29';
      if (cell.path) color = '#e8bd4666'; if (!cell.loS) color = '#4f89e866';
      if (cell.paddock) color = '#aa774c77'; if (cell.fightCell === 1) color = '#eb575788'; if (cell.fightCell === 2) color = '#578cff88';
      diamond(ctx, p.x, p.y); ctx.fillStyle = color; ctx.fill();
    }
    if (views.grid || selected.includes(cell.id) || hovered === cell.id) {
      diamond(ctx, p.x, p.y); ctx.lineWidth = selected.includes(cell.id) ? 2 : 0.6;
      ctx.strokeStyle = selected.includes(cell.id) ? '#fff6a0' : hovered === cell.id ? '#ed91f0' : '#ffffff39'; ctx.stroke();
    }
    if (views.ids) { ctx.fillStyle = '#fff'; ctx.font = '9px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(String(cell.id), p.x, p.y + 3); }
    if (cell.triggerCell) { ctx.fillStyle = '#ffe467'; ctx.fillRect(p.x - 2, p.y - 2, 4, 4); }
    if (cell.io) { ctx.fillStyle = '#9ce9f5'; ctx.font = '9px sans-serif'; ctx.fillText('IO', p.x, p.y - 4); }
  }
}
export function pickCell(map: MapDocument, x: number, y: number): number | null {
  const row = Math.floor(y / (CELL_HALF / 2));
  const approximate = Math.floor(row / 2);
  for (let r = Math.max(0, approximate - 2); r <= Math.min(map.height - 1, approximate + 2); r++) {
    for (let c = 0; c < map.width * 2 - 1; c++) {
      const id = r * (map.width * 2 - 1) + c; if (!map.cells[id]) continue;
      const p = cellPosition(id, map.width);
      if (Math.abs(x - p.x) / CELL_HALF + Math.abs(y - p.y) / (CELL_HALF / 2) <= 1) return id;
    }
  }
  return null;
}
export function makeThumbnail(map: MapDocument, views: ViewOptions, tiles: Map<number, TileAsset>, cache: ImageCache): string {
  const canvas = document.createElement('canvas'); canvas.width = map.width * CELL_HALF * 2; canvas.height = map.height * CELL_HALF;
  const ctx = canvas.getContext('2d')!;
  renderMap(ctx, map, { ...views, grid: false, ids: false, cellMode: false, background: true, ground: true, layer2: true, layer3: true }, tiles, cache);
  return canvas.toDataURL('image/png');
}
export function makeCellThumbnail(map: MapDocument, tiles: Map<number, TileAsset>, cache: ImageCache): string {
  const canvas = document.createElement('canvas'); canvas.width = map.width * CELL_HALF * 2; canvas.height = map.height * CELL_HALF;
  const ctx = canvas.getContext('2d')!;
  renderMap(ctx, map, { background: true, ground: true, layer2: true, layer3: true, grid: true, ids: false, cellMode: true }, tiles, cache);
  return canvas.toDataURL('image/png');
}
