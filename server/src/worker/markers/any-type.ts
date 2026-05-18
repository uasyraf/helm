const COLON_ANY_RE = /:\s+any(?![a-zA-Z_$0-9])/;
const AS_ANY_RE = /(?:^|[^a-zA-Z_$0-9])as\s+any(?![a-zA-Z_$0-9])/;

export interface AnyTypeSignal {
  line: number;
  text: string;
}

export function detectAnyType(text: string, startLine = 1): AnyTypeSignal[] {
  const out: AnyTypeSignal[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    if (COLON_ANY_RE.test(line) || AS_ANY_RE.test(line)) {
      out.push({ line: startLine + i, text: line.trim() });
    }
  }
  return out;
}

export function isTypeScriptFile(filePath: string): boolean {
  return /\.(ts|tsx|mts|cts)$/.test(filePath);
}
