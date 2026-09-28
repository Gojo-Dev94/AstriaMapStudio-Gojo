import 'dotenv/config';
import mysql, { type RowDataPacket } from 'mysql2/promise';
import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('Set DATABASE_URL');
const names = process.argv.slice(2).length ? process.argv.slice(2) : (process.env.SCHEMA_DATABASES ?? new URL(url).pathname.slice(1)).split(',');
if (!names.length || names.some(name => !/^[a-zA-Z0-9_]+$/.test(name))) throw new Error('Invalid database name');
const conn = await mysql.createConnection(url);
try {
  const placeholders = names.map(() => '?').join(',');
  const [tables] = await conn.query<RowDataPacket[]>(`SELECT TABLE_SCHEMA AS dbName, TABLE_NAME AS tableName, TABLE_TYPE AS tableType, ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA IN (${placeholders}) ORDER BY TABLE_SCHEMA,TABLE_NAME`, names);
  const [columns] = await conn.query<RowDataPacket[]>(`SELECT TABLE_SCHEMA AS dbName, TABLE_NAME AS tableName, ORDINAL_POSITION AS ordinal, COLUMN_NAME AS columnName, COLUMN_TYPE AS columnType, IS_NULLABLE AS nullable, COLUMN_DEFAULT AS defaultValue, COLUMN_KEY AS columnKey, EXTRA AS extra FROM information_schema.COLUMNS WHERE TABLE_SCHEMA IN (${placeholders}) ORDER BY TABLE_SCHEMA,TABLE_NAME,ORDINAL_POSITION`, names);
  const path = resolve(dirname(fileURLToPath(import.meta.url)), '../docs/emulator-schema.json');
  await writeFile(path, JSON.stringify({ databases: names, tables, columns }, null, 2) + '\n');
  for (const db of names) console.log(`${db}: ${tables.filter(row => row.dbName === db).length} tables, ${columns.filter(row => row.dbName === db).length} columns`);
  console.log(`Schema inventory saved to ${path}`);
} finally { await conn.end(); }
