import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '../../common/services/logger.service';

const logger = createLogger('ChromiumProfileUtil');

const LOCK_FILE_NAMES = new Set(['SingletonLock', 'SingletonSocket', 'SingletonCookie']);

export function getLocalAuthSessionDir(sessionDataPath: string, clientId: string): string {
  return path.join(path.resolve(sessionDataPath), `session-${clientId}`);
}

export function isChromiumProfileLockError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /profile appears to be in use/i.test(message) ||
    /process_singleton/i.test(message) ||
    /Failed to launch the browser process/i.test(message) ||
    /Code:\s*21/i.test(message)
  );
}

export function cleanChromiumProfileLocks(profileDir: string, maxDepth = 5): number {
  return cleanLocksRecursive(profileDir, 0, maxDepth);
}

export function cleanAllSessionProfileLocks(sessionDataPath: string): number {
  const baseDir = path.resolve(sessionDataPath);
  if (!fs.existsSync(baseDir)) {
    return 0;
  }

  let removed = 0;
  try {
    for (const entry of fs.readdirSync(baseDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith('session-')) {
        continue;
      }
      removed += cleanChromiumProfileLocks(path.join(baseDir, entry.name));
    }
  } catch (error) {
    logger.warn('Failed to scan session directories for Chromium locks', {
      baseDir,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (removed > 0) {
    logger.log(`Removed ${removed} stale Chromium lock file(s)`, { baseDir, removed });
  }

  return removed;
}

function cleanLocksRecursive(dir: string, depth: number, maxDepth: number): number {
  if (depth > maxDepth || !fs.existsSync(dir)) {
    return 0;
  }

  let removed = 0;

  for (const lockName of LOCK_FILE_NAMES) {
    const lockPath = path.join(dir, lockName);
    if (!fs.existsSync(lockPath)) {
      continue;
    }

    try {
      fs.rmSync(lockPath, { force: true });
      removed++;
      logger.debug(`Removed Chromium lock: ${lockPath}`);
    } catch (error) {
      logger.warn(`Failed to remove Chromium lock: ${lockPath}`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (depth >= maxDepth) {
    return removed;
  }

  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }

      if (entry.name === 'Default' || entry.name.startsWith('Profile') || entry.name === 'browser') {
        removed += cleanLocksRecursive(path.join(dir, entry.name), depth + 1, maxDepth);
      }
    }
  } catch (error) {
    logger.warn(`Failed to walk profile directory: ${dir}`, {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return removed;
}
