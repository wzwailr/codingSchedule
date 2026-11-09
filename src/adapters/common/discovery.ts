import { opendir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { SourceFile } from '../types.js';
export type Discovery = { candidates: SourceFile[]; active: SourceFile[]; unavailable: string[] };
export async function discoverCandidates(roots: string[], now: number,ignoredDirectories:readonly string[]=[]): Promise<Discovery> {
  const candidates: SourceFile[] = [], unavailable: string[] = [];
  let visited = 0;
  async function visit(path: string, depth: number): Promise<void> {
    if (depth > 6 || visited >= 4000) return;
    try {
      const directory = await opendir(path);
      for await (const entry of directory) {
        if (++visited > 4000) break;
        const child = join(path, entry.name);
        if (entry.isDirectory()&&!ignoredDirectories.includes(entry.name)) await visit(child, depth + 1);
        else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
          try { const s = await stat(child); if (s.mtimeMs >= now - 86_400_000) candidates.push({ path: child, provider: 'generic', mtimeMs: s.mtimeMs }); } catch { unavailable.push(child); }
        }
      }
    } catch { unavailable.push(path); }
  }
  for (const root of roots) await visit(root, 0);
  candidates.sort((a,b) => b.mtimeMs - a.mtimeMs || a.path.localeCompare(b.path));
  return { candidates: candidates.slice(0, 200), active: candidates.slice(0, 20), unavailable };
}
