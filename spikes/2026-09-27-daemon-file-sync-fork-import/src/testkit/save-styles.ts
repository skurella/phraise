// Brief 02 task 2 / plan section 5: the three ways real editors save a file.
import {
  closeSync,
  existsSync,
  ftruncateSync,
  openSync,
  renameSync,
  statSync,
  writeSync,
} from 'node:fs';
import { writeFile } from 'node:fs/promises';
import * as path from 'node:path';

/** Write in place on an open fd without truncating first: write the new bytes, then trim to length. */
export async function saveInPlace(filePath: string, content: string): Promise<void> {
  const buf = Buffer.from(content, 'utf8');
  const mode = existsSync(filePath) ? statSync(filePath).mode : 0o644;
  const fd = openSync(filePath, existsSync(filePath) ? 'r+' : 'w+', mode);
  try {
    let written = 0;
    while (written < buf.length) {
      written += writeSync(fd, buf, written, buf.length - written, written);
    }
    ftruncateSync(fd, buf.length);
  } finally {
    closeSync(fd);
  }
}

/** Write a temporary file beside the target, then rename it over the target. */
export async function saveRenameOver(filePath: string, content: string): Promise<void> {
  const dir = path.dirname(filePath);
  const tmp = path.join(dir, `.${path.basename(filePath)}.savetmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await writeFile(tmp, content, 'utf8');
  renameSync(tmp, filePath);
}

/** Truncate the file, wait a few ms, then write: some editors pass through an empty file. */
export async function saveTruncateThenWrite(filePath: string, content: string): Promise<void> {
  const fd = openSync(filePath, 'r+');
  try {
    ftruncateSync(fd, 0);
  } finally {
    closeSync(fd);
  }
  await new Promise((resolve) => setTimeout(resolve, 5));
  await writeFile(filePath, content, 'utf8');
}

export type SaveStyle = 'in-place' | 'rename-over' | 'truncate-then-write';

export const SAVE_STYLES: readonly SaveStyle[] = ['in-place', 'rename-over', 'truncate-then-write'];

export async function saveWithStyle(style: SaveStyle, filePath: string, content: string): Promise<void> {
  switch (style) {
    case 'in-place':
      return saveInPlace(filePath, content);
    case 'rename-over':
      return saveRenameOver(filePath, content);
    case 'truncate-then-write':
      return saveTruncateThenWrite(filePath, content);
  }
}
