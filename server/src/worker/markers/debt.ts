export type Severity = "low" | "med" | "high" | "critical";

export interface DebtMarker {
  owner?: string;
  expires?: string;
  severity?: Severity;
  ref?: string;
  description: string;
  line: number;
  raw: string;
}

const KNOWN_SEVERITIES: ReadonlySet<Severity> = new Set(["low", "med", "high", "critical"]);
const MARKER_RE = /(?:\/\/|#|--)\s*DEBT\(([^)]*)\)\s*:?\s*(.*)$/;

export function parseDebtMarkers(text: string, startLine = 1): DebtMarker[] {
  const out: DebtMarker[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const match = MARKER_RE.exec(line);
    if (!match) continue;
    const [, body, trailing] = match;
    if (body === undefined) continue;
    out.push({ ...parseFields(body), description: (trailing ?? "").trim() || body.trim(), line: startLine + i, raw: line.trim() });
  }
  return out;
}

function parseFields(body: string): Pick<DebtMarker, "owner" | "expires" | "severity" | "ref"> {
  const result: { owner?: string; expires?: string; severity?: Severity; ref?: string } = {};
  for (const pair of splitFields(body)) {
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    const key = pair.slice(0, eq).trim().toLowerCase();
    const value = unquote(pair.slice(eq + 1).trim());
    if (!value) continue;
    if (key === "owner") result.owner = value;
    else if (key === "expires") result.expires = value;
    else if (key === "severity" && KNOWN_SEVERITIES.has(value as Severity)) result.severity = value as Severity;
    else if (key === "ref") result.ref = value;
  }
  return result;
}

function splitFields(body: string): string[] {
  return body
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function unquote(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}
