import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, basename, dirname } from 'node:path';
import type { SpecDocument } from './types.js';

const DEFAULT_EXTENSIONS = new Set(['.md', '.tpl']);

export interface LoadOptions {
  /** Workspace root used to compute relative display paths. */
  root: string;
  /** File extensions to include (lowercased, with leading dot). */
  extensions?: Set<string>;
}

export function loadSpecs(inputDir: string, options: LoadOptions): SpecDocument[] {
  const extensions = options.extensions ?? DEFAULT_EXTENSIONS;
  const files = walk(inputDir);
  const docs: SpecDocument[] = [];

  for (const path of files) {
    const lower = path.toLowerCase();
    const dot = lower.lastIndexOf('.');
    if (dot < 0) continue;
    const ext = lower.slice(dot);
    if (!extensions.has(ext)) continue;

    const content = readFileSync(path, 'utf8');
    const lines = content.split(/\r?\n/);
    const rel = relative(options.root, path).replace(/\\/g, '/');
    const displayName = `${basename(dirname(path))}/${basename(path)}`;
    docs.push({ path: rel, displayName, content, lines });
  }

  docs.sort((a, b) => a.path.localeCompare(b.path));
  return docs;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  const stack: string[] = [dir];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(current, entry);
      let info;
      try {
        info = statSync(full);
      } catch {
        continue;
      }
      if (info.isDirectory()) {
        stack.push(full);
      } else if (info.isFile()) {
        out.push(full);
      }
    }
  }
  return out;
}
