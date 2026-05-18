import { createServer, type Server, type Socket } from "node:net";
import { existsSync, mkdirSync, unlinkSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname } from "node:path";
import { openProjectDb } from "../db/open-project.js";
import { bootstrapSession } from "../project/bootstrap.js";
import { helmHome } from "../util/paths.js";
import { scanPayload, type HookPayload } from "./scanner.js";
import { ingestScan } from "./ingest.js";
import { workerSocketPath, workerPidPath, workerLogPath } from "./socket.js";

const IDLE_TIMEOUT_MS = 10 * 60 * 1000;

interface ScanRequest {
  type: "scan";
  cwd: string;
  payload: HookPayload;
}

interface PingRequest {
  type: "ping";
}

interface ShutdownRequest {
  type: "shutdown";
}

type Request = ScanRequest | PingRequest | ShutdownRequest;

function log(msg: string): void {
  try {
    appendFileSync(workerLogPath(), `${new Date().toISOString()} ${msg}\n`);
  } catch {
    // ignore log errors — worker stays alive
  }
}

export async function runWorker(): Promise<void> {
  mkdirSync(helmHome(), { recursive: true });
  const sockPath = workerSocketPath();
  if (existsSync(sockPath)) {
    try {
      unlinkSync(sockPath);
    } catch {
      // ignore
    }
  }
  mkdirSync(dirname(sockPath), { recursive: true });

  const server = createServer((socket) => handleConnection(socket, () => resetIdle(server)));
  let idleTimer = setIdleTimer(server);

  function resetIdle(srv: Server): void {
    clearTimeout(idleTimer);
    idleTimer = setIdleTimer(srv);
  }

  function setIdleTimer(srv: Server): NodeJS.Timeout {
    return setTimeout(() => {
      log("idle timeout — shutting down");
      srv.close(() => process.exit(0));
    }, IDLE_TIMEOUT_MS);
  }

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(sockPath, () => resolve());
  });

  writeFileSync(workerPidPath(), String(process.pid));
  log(`worker listening on ${sockPath}`);

  const cleanup = (): void => {
    log("signal received — shutting down");
    server.close(() => {
      try {
        unlinkSync(workerPidPath());
      } catch {
        // ignore
      }
      process.exit(0);
    });
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}

function handleConnection(socket: Socket, onActivity: () => void): void {
  let buffer = "";
  socket.setEncoding("utf8");
  socket.on("data", (chunk) => {
    onActivity();
    buffer += chunk;
    let idx: number;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      if (!line.trim()) continue;
      void processLine(line, socket);
    }
  });
  socket.on("error", () => {
    socket.destroy();
  });
}

async function processLine(line: string, socket: Socket): Promise<void> {
  let req: Request;
  try {
    req = JSON.parse(line) as Request;
  } catch (err) {
    socket.write(JSON.stringify({ ok: false, error: `parse: ${(err as Error).message}` }) + "\n");
    return;
  }

  try {
    if (req.type === "ping") {
      socket.write(JSON.stringify({ ok: true, pong: true }) + "\n");
      return;
    }
    if (req.type === "shutdown") {
      socket.write(JSON.stringify({ ok: true, shutdown: true }) + "\n");
      socket.end();
      setImmediate(() => process.exit(0));
      return;
    }
    if (req.type === "scan") {
      const summary = await processScan(req);
      socket.write(JSON.stringify({ ok: true, summary }) + "\n");
      return;
    }
    socket.write(JSON.stringify({ ok: false, error: "unknown request type" }) + "\n");
  } catch (err) {
    log(`error: ${(err as Error).message}`);
    socket.write(JSON.stringify({ ok: false, error: (err as Error).message }) + "\n");
  }
}

async function processScan(req: ScanRequest): Promise<{ inserted: number; skipped: number; filePath: string | null }> {
  const { handle, slug } = await openProjectDb(req.cwd);
  try {
    const session = await bootstrapSession(handle.db, req.cwd);
    const scan = scanPayload(req.payload);
    const summary = await ingestScan(scan, {
      db: handle.db,
      projectId: session.project.id,
      developerId: session.developer.id,
      sprintId: session.activeSprint.id,
    });
    if (summary.inserted > 0) {
      log(`scan ${slug}: +${summary.inserted} debt (${summary.skipped} skipped) @ ${summary.filePath ?? "?"}`);
    }
    if (handle.sync) await handle.sync();
    return summary;
  } finally {
    handle.client.close();
  }
}
