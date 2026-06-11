import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  cleanAllSessionProfileLocks,
  cleanChromiumProfileLocks,
  getLocalAuthSessionDir,
  isChromiumProfileLockError,
} from './chromium-profile.util';

describe('chromium-profile.util', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openwa-chromium-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should resolve LocalAuth session directory', () => {
    expect(getLocalAuthSessionDir(tempDir, 'my-bot')).toBe(path.join(tempDir, 'session-my-bot'));
  });

  it('should remove Chromium singleton lock files', () => {
    const profileDir = path.join(tempDir, 'session-test', 'Default');
    fs.mkdirSync(profileDir, { recursive: true });
    fs.writeFileSync(path.join(profileDir, 'SingletonLock'), 'lock');
    fs.writeFileSync(path.join(profileDir, 'SingletonSocket'), 'socket');
    fs.writeFileSync(path.join(profileDir, 'SingletonCookie'), 'cookie');

    const removed = cleanChromiumProfileLocks(path.join(tempDir, 'session-test'));

    expect(removed).toBe(3);
    expect(fs.existsSync(path.join(profileDir, 'SingletonLock'))).toBe(false);
  });

  it('should clean all session directories under base path', () => {
    const sessionA = path.join(tempDir, 'session-a');
    const sessionB = path.join(tempDir, 'session-b');
    fs.mkdirSync(path.join(sessionA, 'Default'), { recursive: true });
    fs.mkdirSync(path.join(sessionB, 'Default'), { recursive: true });
    fs.writeFileSync(path.join(sessionA, 'SingletonLock'), 'lock');
    fs.writeFileSync(path.join(sessionB, 'SingletonLock'), 'lock');

    const removed = cleanAllSessionProfileLocks(tempDir);

    expect(removed).toBe(2);
  });

  it('should detect Chromium profile lock errors', () => {
    expect(
      isChromiumProfileLockError(
        new Error('Failed to launch the browser process: Code: 21 profile appears to be in use'),
      ),
    ).toBe(true);
    expect(isChromiumProfileLockError(new Error('Network timeout'))).toBe(false);
  });
});
