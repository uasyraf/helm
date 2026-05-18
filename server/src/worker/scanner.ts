import { parseDebtMarkers, type DebtMarker } from "./markers/debt.js";
import { detectLargeFile, type LargeFileSignal } from "./markers/file-size.js";
import { detectAnyType, isTypeScriptFile, type AnyTypeSignal } from "./markers/any-type.js";

export interface HookPayload {
  tool_name: "Edit" | "Write" | "MultiEdit" | string;
  tool_input: {
    file_path?: string;
    old_string?: string;
    new_string?: string;
    content?: string;
    edits?: Array<{ old_string: string; new_string: string }>;
  };
}

export interface ScanResult {
  filePath: string | null;
  markers: DebtMarker[];
  largeFile: LargeFileSignal | null;
  anyTypes: AnyTypeSignal[];
}

export function scanPayload(payload: HookPayload): ScanResult {
  const filePath = payload.tool_input.file_path ?? null;
  const scannedText = textToScan(payload);
  const markers = scannedText ? parseDebtMarkers(scannedText) : [];
  const largeFile = filePath ? detectLargeFile(filePath) : null;
  const anyTypes = filePath && isTypeScriptFile(filePath) && scannedText ? detectAnyType(scannedText) : [];
  return { filePath, markers, largeFile, anyTypes };
}

function textToScan(payload: HookPayload): string {
  const { tool_name, tool_input } = payload;
  if (tool_name === "Write") return tool_input.content ?? "";
  if (tool_name === "Edit") return tool_input.new_string ?? "";
  if (tool_name === "MultiEdit") {
    return (tool_input.edits ?? []).map((e) => e.new_string).join("\n");
  }
  return "";
}
