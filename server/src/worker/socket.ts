import { join } from "node:path";
import { helmHome } from "../util/paths.js";

export function workerSocketPath(): string {
  return process.env.HELM_WORKER_SOCK ?? join(helmHome(), "worker.sock");
}

export function workerPidPath(): string {
  return join(helmHome(), "worker.pid");
}

export function workerLogPath(): string {
  return join(helmHome(), "worker.log");
}
