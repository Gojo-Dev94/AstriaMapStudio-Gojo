import sharp from 'sharp';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanAssets } from '../server/assets.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const exists = async (path: string) => { try { await access(path); return true; } catch { return false; } };
const assetsRoot = resolve(root, process.env.ASSET_ROOT ?? (await exists(resolve(root, 'assets/Images')) ? 'assets/Images' : '../../Images'));
const metadataRoot = resolve(root, process.env.METADATA_ROOT ?? (await exists(resolve(root, 'assets/XML')) ? 'assets/XML' : '../bin/AME Gojo/XML'));
const baseUrl = process.env.ASSET_BASE_URL ?? '/tile-assets';
const output = resolve(root, 'atlas');
const size = 2048, pad = 2;
await mkdir(output, { recursive: true });
const allAssets = await scanAssets(assetsRoot, metadataRoot, baseUrl);
const assets = process.env.ATLAS_LIMIT ? allAssets.slice(0, Math.max(1, Number(process.env.ATLAS_LIMIT))) : allAssets;
const groups = new Map<string, typeof assets>();
for (const asset of assets) { const key = `${asset.type}-${asset.pack}`; groups.set(key, [...(groups.get(key) ?? []), asset]); }
const manifest: { atlas: string; tiles: { id: number; type: number; x: number; y: number; width: number; height: number; originX: number; originY: number }[] }[] = [];
for (const [group, entries] of groups) {
  let page = 0, x = pad, y = pad, rowHeight = 0;
  let pieces: { input: string; left: number; top: number }[] = [];
  let metadata: { id: number; type: number; x: number; y: number; width: number; height: number; originX: number; originY: number }[] = [];
  const flush = async () => {
    if (!pieces.length) return;
    const name = `${group.replace(/[^A-Za-z0-9_-]/g, '_')}-${page++}.png`;
    await sharp({ create: { width: size, height: size, channels: 4, background: '#00000000' } }).composite(pieces).png().toFile(resolve(output, name));
    manifest.push({ atlas: name, tiles: metadata }); pieces = []; metadata = []; x = pad; y = pad; rowHeight = 0;
  };
  for (const asset of entries) {
    const input = resolve(assetsRoot, decodeURIComponent(asset.url.slice(`${baseUrl.replace(/\/$/, '')}/`.length)));
    const info = await sharp(input).metadata(); if (!info.width || !info.height || info.width + pad * 2 > size || info.height + pad * 2 > size) continue;
    if (x + info.width + pad > size) { x = pad; y += rowHeight + pad; rowHeight = 0; }
    if (y + info.height + pad > size) await flush();
    pieces.push({ input, left: x, top: y });
    metadata.push({ id: asset.id, type: asset.type, x, y, width: info.width, height: info.height,
      originX: asset.x || info.width / 2, originY: asset.y || info.height / 2 });
    x += info.width + pad; rowHeight = Math.max(rowHeight, info.height);
  }
  await flush();
}
await writeFile(resolve(output, 'manifest.json'), JSON.stringify({ version: 1, size, pages: manifest }, null, 2));
console.log(`Created ${manifest.length} atlas pages for ${assets.length} assets in ${output}`);
