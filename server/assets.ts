import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import type { TileAsset } from '../src/domain.ts';

const extract = (xml: string, tag: string, field: string): { id: number; name: string }[] => {
  const items: { id: number; name: string }[] = [];
  for (const match of xml.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'g'))) {
    const id = Number(match[1].match(/<ID>(.*?)<\/ID>/)?.[1]);
    const name = match[1].match(new RegExp(`<${field}>([\\s\\S]*?)<\\/${field}>`))?.[1] ?? '';
    if (Number.isSafeInteger(id)) items.push({ id, name: name.replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>') });
  }
  return items;
};
export async function readMetadata(root: string, file: string, tag: string): Promise<{ id: number; name: string }[]> {
  try { return extract(await readFile(join(root, file), 'utf8'), tag, 'Name'); }
  catch { return []; }
}
export async function readOrigins(root: string, file: string): Promise<Map<number, { x: number; y: number }>> {
  try {
    const xml = await readFile(join(root, file), 'utf8');
    const result = new Map<number, { x: number; y: number }>();
    for (const match of xml.matchAll(/<Pos>([\s\S]*?)<\/Pos>/g)) {
      const id = Number(match[1].match(/<ID>(.*?)<\/ID>/)?.[1]);
      const x = Number(match[1].match(/<X>(.*?)<\/X>/)?.[1]);
      const y = Number(match[1].match(/<Y>(.*?)<\/Y>/)?.[1]);
      if (Number.isSafeInteger(id)) result.set(id, { x, y });
    }
    return result;
  } catch { return new Map(); }
}
async function files(root: string, dir: string): Promise<string[]> {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return []; }
  const children = await Promise.all(entries.map(entry => entry.isDirectory() ? files(root, join(dir, entry.name)) : Promise.resolve(entry.isFile() && /\.png$/i.test(entry.name) ? [join(dir, entry.name)] : [])));
  return children.flat();
}
export async function scanAssets(root: string, metadataRoot: string, baseUrl = '/tile-assets'): Promise<TileAsset[]> {
  const [grounds, objects] = await Promise.all([readOrigins(metadataRoot, 'grounds.xml'), readOrigins(metadataRoot, 'objects.xml')]);
  const types: [string, 0 | 1 | 2, Map<number, { x: number; y: number }>][] = [
    ['backgrounds', 2, new Map()], ['grounds', 0, grounds], ['objects', 1, objects] ];
  const found = await Promise.all(types.map(async ([folder, type, origins]) => (await files(root, join(root, folder))).flatMap(path => {
    const id = Number(path.match(/(\d+)\.png$/i)?.[1]);
    if (!Number.isSafeInteger(id)) return [];
    const rel = relative(root, path).split(sep).join('/');
    const pack = relative(join(root, folder), join(path, '..')).split(sep).join('/') || 'default';
    const origin = origins.get(id) ?? { x: 0, y: 0 };
    return [{ id, type, pack, url: `${baseUrl.replace(/\/$/, '')}/${rel.split('/').map(encodeURIComponent).join('/')}`, ...origin }];
  })));
  return found.flat().sort((a, b) => a.type - b.type || a.pack.localeCompare(b.pack) || a.id - b.id);
}
