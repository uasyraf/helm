import { connect, type Socket } from "node:net";
import { spawn } from "node:child_process";
import { openSync, closeSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { workerSocketPath, workerLogPath } from "./socket.js";
import type { HookPayload } from "./scanner.js";

interface ScanResponse {
  ok: boolean;
  summary?: { inserted: number; skipped: number; filePath: string | null };
  error?: string;
}

const CONNECT_RETRIES = 5;
const RETRY_DELAY_MS = 200;

export async function sendScan(cwd: string, payload: HookPayload): Promise<ScanResponse> {
  for (let attempt = 0; attempt < CONNECT_RETRIES; attempt++) {
    try {
      return await attemptSend(cwd, payload);
    } catch (err) {
      if (attempt === 0 && !existsSync(workerSocketPath())) {
        spawnWorker();
      }
      await sleep(RETRY_DELAY_MS * (attempt + 1));
      if (attempt === CONNECT_RETRIES - 1) {
        return { ok: false, error: `worker unreachable: ${(err as Error).message}` };
      }
    }
  }
  return { ok: false, error: "exhausted retries" };
}

function attemptSend(cwd: string, payload: HookPayload): Promise<ScanResponse> {
  return new Promise((resolve, reject) => {
    const sock: Socket = connect(workerSocketPath());
    let buffer = "";
    let settled = false;

    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      fn();
    };

    sock.setEncoding("utf8");
    sock.once("connect", () => {
      const req = JSON.stringify({ type: "scan", cwd, payload }) + "\n";
      sock.write(req);
    });
    sock.on("data", (chunk) => {
      buffer += chunk;
      const idx = buffer.indexOf("\n");
      if (idx >= 0) {
        try {
          const parsed = JSON.parse(buffer.slice(0, idx)) as ScanResponse;
          settle(() => {
            sock.end();
            resolve(parsed);
          });
        } catch (err) {
          settle(() => {
            sock.destroy();
            reject(err);
          });
        }
      }
    });
    sock.once("error", (err) => settle(() => reject(err)));
    sock.once("close", () => settle(() => reject(new Error("socket closed without response"))));
  });
}

function spawnWorker(): void {
  try {
    const binPath = resolveOwnBin();
    const out = openSync(workerLogPath(), "a");
    const err = openSync(workerLogPath(), "a");
    const child = spawn(process.execPath, [binPath, "worker"], {
      detached: true,
      stdio: ["ignore", out, err],
    });
    child.unref();
    closeSync(out);
    closeSync(err);
  } catch {
    // best-effort; if we can't spawn, the retry loop will surface the error
  }
}

function resolveOwnBin(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "..", "..", "bin", "helm.js");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
