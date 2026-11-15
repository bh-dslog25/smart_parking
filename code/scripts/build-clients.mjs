import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const frontend = resolve(root, 'Web/frontend');
const target = process.argv[2];
if (!['desktop', 'android'].includes(target)) throw new Error('Use desktop or android');
const run = (file, args, cwd) => {
  const result = spawnSync(process.execPath, [file, ...args], { cwd, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
};
run(resolve(frontend, 'node_modules/typescript/bin/tsc'), ['--noEmit'], frontend);
run(resolve(frontend, 'node_modules/vite/bin/vite.js'), ['build', '--mode', 'native'], frontend);
if (target === 'desktop') {
  const dest = resolve(root, 'Desktop/ui');
  mkdirSync(dest, { recursive: true });
  cpSync(resolve(frontend, 'dist'), dest, { recursive: true });
} else {
  run(resolve(root, 'Android/node_modules/@capacitor/cli/bin/capacitor'), ['sync', 'android'], resolve(root, 'Android'));
}
