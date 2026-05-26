#!/usr/bin/env node
// Copies non-TS assets that the build needs but `tsc -p tsconfig.build.json`
// will not emit. Currently: the GitHub Actions workflow template that
// `runBootstrap` reads at runtime to scaffold `.github/workflows/agent-core-gate.yml`
// into downstream projects.
import { mkdirSync, readdirSync, statSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..');
const srcDir = resolve(projectRoot, 'src', 'templates');
const dstDir = resolve(projectRoot, 'dist', 'templates');

if (!existsSync(srcDir)) {
  console.error(`[copy-assets] source not found: ${srcDir}`);
  process.exit(1);
}
mkdirSync(dstDir, { recursive: true });

let copied = 0;
for (const entry of readdirSync(srcDir)) {
  const s = join(srcDir, entry);
  const d = join(dstDir, entry);
  if (statSync(s).isFile()) {
    copyFileSync(s, d);
    copied++;
  }
}

console.log(`[copy-assets] copied ${copied} asset(s) ${srcDir} -> ${dstDir}`);
