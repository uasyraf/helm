import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { schema } from "./schema.js";
import { bootstrap } from "./bootstrap.js";
import type { SyncConfig } from "../config/load.js";

export type Db = LibSQLDatabase<typeof schema>;

export interface DbHandle {
  readonly db: Db;
  readonly client: Client;
  readonly sync: (() => Promise<void>) | null;
}

export interface OpenDbOptions {
  sync?: SyncConfig | null;
}

export async function openDb(dbPath: string, opts: OpenDbOptions = {}): Promise<DbHandle> {
  mkdirSync(dirname(dbPath), { recursive: true });
  const client = opts.sync
    ? createClient({
        url: `file:${dbPath}`,
        syncUrl: opts.sync.url,
        authToken: opts.sync.authToken,
        syncInterval: opts.sync.syncIntervalMs ? opts.sync.syncIntervalMs / 1000 : undefined,
      })
    : createClient({ url: `file:${dbPath}` });

  if (opts.sync) {
    try {
      await client.sync();
    } catch (err) {
      console.warn(`[helm] initial sync failed: ${(err as Error).message}`);
    }
  }

  await bootstrap(client);
  const db = drizzle(client, { schema });
  const sync = opts.sync ? async (): Promise<void> => {
    await client.sync();
  } : null;
  return { db, client, sync };
}
