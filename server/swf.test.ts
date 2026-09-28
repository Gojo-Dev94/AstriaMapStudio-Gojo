import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inflateSync } from 'node:zlib';
import { decodeAstriaSwf } from './swf.ts';
import { encodeMapData } from '../src/legacy.ts';

describe('Astria SWF importer', () => {
  it('extracts the bundled legacy Astria map and metadata', () => {
    const file = resolve(import.meta.dirname, 'fixtures/14444_AME.swf');
    const swf = readFileSync(file);
    const map = decodeAstriaSwf(swf, '14444_AME.swf');
    expect(map.id).toBe(14444);
    expect(map.width).toBe(19);
    expect(map.height).toBe(22);
    expect(map.cells).toHaveLength(796);
    expect(map.dateMap).toBe('AME');
    const unpacked = inflateSync(swf.subarray(8));
    const start = unpacked.indexOf('mapData') + 8;
    expect(encodeMapData(map)).toBe(unpacked.toString('ascii', start, unpacked.indexOf(0, start)));
  });
  it('rejects unknown signatures', () => expect(() => decodeAstriaSwf(Buffer.from('bad file'))).toThrow('Unsupported Astria SWF'));
});
