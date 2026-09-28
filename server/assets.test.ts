import { expect, it } from 'vitest';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { scanAssets } from './assets.ts';

it('discovers the bundled packs and preserves sprite origins with a CDN base URL', async () => {
  const root = resolve(import.meta.dirname, '..');
  const localAssets = resolve(root, 'assets/Images');
  const localXml = resolve(root, 'assets/XML');
  const assets = await scanAssets(existsSync(localAssets) ? localAssets : resolve(root, '../../Images'), existsSync(localXml) ? localXml : resolve(root, '../bin/AME Gojo/XML'), 'https://cdn.example.test/assets');
  expect(assets.length).toBeGreaterThan(5000);
  const ground = assets.find(tile => tile.type === 0 && tile.id === 3);
  expect(ground).toMatchObject({ pack: 'Autre', x: 27, y: 14, url: 'https://cdn.example.test/assets/grounds/Autre/3.png' });
});
