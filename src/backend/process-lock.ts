import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

export class ProcessLockUnavailableError extends Error {
  constructor(name: string) {
    super(`The "${name}" task is already active in another process.`);
    this.name = 'ProcessLockUnavailableError';
  }
}

export interface ProcessLock {
  heartbeat(): void;
  release(): void;
}

function lockPaths(directory: string, name: string): { database: string; heartbeat: string } {
  const key = createHash('sha256').update(name).digest('hex');
  return {
    database: path.join(directory, `${key}.sqlite`),
    heartbeat: path.join(directory, `${key}.json`),
  };
}

export function acquireProcessLock(
  directory: string,
  name: string,
  heartbeatIntervalMs = 5000,
): ProcessLock {
  if (!name.trim()) throw new Error('A process lock name is required.');
  mkdirSync(directory, { recursive: true });
  const paths = lockPaths(directory, name);
  const database = new DatabaseSync(paths.database);
  try {
    database.exec('PRAGMA busy_timeout = 0; BEGIN EXCLUSIVE;');
  } catch (error) {
    database.close();
    if (
      typeof error === 'object' &&
      error !== null &&
      'errcode' in error &&
      error.errcode === 5
    ) {
      throw new ProcessLockUnavailableError(name);
    }
    throw error;
  }

  const owner = randomUUID();
  let released = false;
  const heartbeat = (): void => {
    if (released) throw new Error('Cannot heartbeat a released process lock.');
    const record = JSON.stringify({
      owner,
      pid: process.pid,
      name,
      updatedAt: new Date().toISOString(),
    });
    writeFileSync(paths.heartbeat, record);
  };
  heartbeat();
  const timer = setInterval(() => {
    try {
      heartbeat();
    } catch (error) {
      console.error(`Could not update heartbeat for "${name}":`, error);
    }
  }, Math.max(1000, heartbeatIntervalMs));
  timer.unref();

  return {
    heartbeat,
    release(): void {
      if (released) return;
      released = true;
      clearInterval(timer);
      try {
        const record = JSON.parse(readFileSync(paths.heartbeat, 'utf8')) as { owner?: unknown };
        if (record.owner === owner) unlinkSync(paths.heartbeat);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      } finally {
        try {
          database.exec('ROLLBACK;');
        } finally {
          database.close();
        }
      }
    },
  };
}
