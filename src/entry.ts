import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * True when the module at `moduleUrl` (pass `import.meta.url`) is the process
 * entry point. Node 22 has no import.meta.main, and comparing URL strings
 * breaks on Windows paths, so compare resolved file paths instead.
 */
export function isEntryPoint(moduleUrl: string, argv1: string | undefined = process.argv[1]): boolean {
  if (!argv1) return false;
  try {
    return fs.realpathSync(argv1) === fs.realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}
