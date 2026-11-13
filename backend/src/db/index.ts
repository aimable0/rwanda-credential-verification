import { Pool } from 'pg';
import dotenv from 'dotenv';
import { logger } from '../logger';

dotenv.config();

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Without this listener, a dropped idle connection (PostgreSQL restart, network blip)
// is an unhandled 'error' event and crashes the process. The pool replaces the client.
pool.on('error', (err) => {
  logger.error('PostgreSQL idle client error', undefined, err);
});

export const query = (text: string, params?: any[]) => pool.query(text, params);
