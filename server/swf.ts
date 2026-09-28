import { inflateSync } from 'node:zlib';
import { decodeMapData } from '../src/legacy.ts';
import { cellCount, type MapDocument } from '../src/domain.ts';

function fail(message: string): never { throw new Error(`Unsupported Astria SWF: ${message}`); }
function valueAfter(poolIndex: number, bytes: Buffer): number | boolean {
  const marker = Buffer.from([0x96, 0x02, 0x00, 0x08, poolIndex, 0x96]);
  const pos = bytes.indexOf(marker);
  if (pos < 0) fail(`constant ${poolIndex} not found`);
  const valueStart = pos + marker.length;
  if (bytes[valueStart] === 0x05 && bytes[valueStart + 1] === 0 && bytes[valueStart + 2] === 0x07) return bytes.readInt32LE(valueStart + 3);
  if (bytes[valueStart] === 0x02 && bytes[valueStart + 1] === 0 && bytes[valueStart + 2] === 0x05) return bytes[valueStart + 3] !== 0;
  fail(`unexpected push for constant ${poolIndex}`);
}
export function decodeAstriaSwf(input: Buffer, filename = ''): MapDocument {
  if (input.length < 8 || input.length > 8 * 1024 * 1024) fail('invalid file size');
  const signature = input.toString('ascii', 0, 3);
  if (signature !== 'FWS' && signature !== 'CWS') fail('only FWS/CWS files are supported');
  const uncompressed = signature === 'CWS' ? Buffer.concat([input.subarray(0, 8), inflateSync(input.subarray(8), { maxOutputLength: 20 * 1024 * 1024 })]) : input;
  if (uncompressed.length > 20 * 1024 * 1024 || input.readUInt32LE(4) !== uncompressed.length) fail('invalid decompressed length');
  const marker = Buffer.from('mapData\0', 'ascii');
  const start = uncompressed.indexOf(marker);
  if (start < 0 || uncompressed.indexOf(marker, start + 1) >= 0) fail('single mapData constant not found');
  const dataStart = start + marker.length, end = uncompressed.indexOf(0, dataStart);
  if (end < 0) fail('unterminated mapData');
  const data = uncompressed.toString('ascii', dataStart, end);
  if (!/^[A-Za-z0-9_-]+$/.test(data)) fail('mapData is encrypted or invalid');
  const tail = uncompressed.subarray(end + 1);
  const id = Number(valueAfter(5, tail)), width = Number(valueAfter(6, tail)), height = Number(valueAfter(7, tail));
  if (!Number.isSafeInteger(id) || id < 1 || !Number.isInteger(width) || !Number.isInteger(height) || width < 2 || width > 100 || height < 2 || height > 100) fail('invalid geometry');
  if (data.length !== cellCount(width, height) * 10) fail('mapData length does not match geometry');
  const map = decodeMapData(data, id, width, height);
  map.backgroundId = Number(valueAfter(8, tail)) || null;
  map.ambianceId = Number(valueAfter(9, tail));
  map.musicId = Number(valueAfter(10, tail));
  map.outdoor = Boolean(valueAfter(11, tail));
  map.capabilities = Number(valueAfter(12, tail));
  const name = filename.match(/^[0-9]+_([^.]*)\.swf$/i)?.[1];
  if (name) map.dateMap = name.slice(0, 32);
  return map;
}
