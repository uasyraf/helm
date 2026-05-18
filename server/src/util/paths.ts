import { homedir } from "node:os";
import { join } from "node:path";

export function helmHome(): string {
  return process.env.HELM_HOME ?? join(homedir(), ".helm");
}

export function dbPathFor(slug: string): string {
  return join(helmHome(), `${slug}.db`);
}
