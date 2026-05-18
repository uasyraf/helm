import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { schema } from "./schema.js";
import { bootstrap } from "./bootstrap.js";

export type Db = LibSQLDatabase<typeof schema>;

export interface DbHandle {
  readonly db: Db;
  readonly client: Client;
}

export async function openDb(dbPath: string): Promise<DbHandle> {
  mkdirSync(dirname(dbPath), { recursive: true });
  const client = createClient({ url: `file:${dbPath}` });
  await bootstrap(client);
  const db = drizzle(client, { schema });
  return { db, client };
}
