import { statSync, readFileSync } from "node:fs";

const LARGE_FILE_THRESHOLD = 500;

export interface LargeFileSignal {
  filePath: string;
  lineCount: number;
}

export function detectLargeFile(filePath: string): LargeFileSignal | null {
  try {
    const stat = statSync(filePath);
    if (!stat.isFile()) return null;
    if (stat.size > 10 * 1024 * 1024) return null;
    const content = readFileSync(filePath, "utf8");
    const lineCount = countLines(content);
    if (lineCount < LARGE_FILE_THRESHOLD) return null;
    return { filePath, lineCount };
  } catch {
    return null;
  }
}

function countLines(content: string): number {
  if (content.length === 0) return 0;
  let count = 1;
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 10) count++;
  }
  if (content.charCodeAt(content.length - 1) === 10) count--;
  return count;
}
