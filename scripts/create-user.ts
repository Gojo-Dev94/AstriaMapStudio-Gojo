import 'dotenv/config';
import mysql from 'mysql2/promise';
import { randomBytes, scryptSync } from 'node:crypto';

const { DATABASE_URL, NEW_USERNAME, NEW_PASSWORD, NEW_ROLE } = process.env;
if (!DATABASE_URL || !NEW_USERNAME || !NEW_PASSWORD || !['viewer', 'editor', 'admin'].includes(NEW_ROLE ?? '')) throw new Error('Set DATABASE_URL, NEW_USERNAME, NEW_PASSWORD and NEW_ROLE=viewer|editor|admin');
if (NEW_USERNAME.length > 100 || NEW_PASSWORD.length < 12) throw new Error('Username must fit 100 characters and password must have at least 12 characters');
const salt = randomBytes(16).toString('hex');
const hash = scryptSync(NEW_PASSWORD, Buffer.from(salt, 'hex'), 64).toString('hex');
const connection = await mysql.createConnection(DATABASE_URL);
try {
  await connection.execute('INSERT INTO editor_users(username, password_salt, password_hash, role) VALUES (?, ?, ?, ?)', [NEW_USERNAME, salt, hash, NEW_ROLE!]);
  console.log(`Created ${NEW_ROLE} user ${NEW_USERNAME}`);
} finally { await connection.end(); }
