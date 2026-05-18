import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { schema as pgSchema } from "./schema-pg.js";
import { bootstrapPg } from "./pg-bootstrap.js";

export type PgDb = NodePgDatabase<typeof pgSchema> | PgliteDatabase<typeof pgSchema>;

export interface PgHandle {
  readonly db: PgDb;
  readonly close: () => Promise<void>;
}

export async function openPgDb(url: string): Promise<PgHandle> {
  const [{ Pool }, { drizzle }] = await Promise.all([
    import("pg"),
    import("drizzle-orm/node-postgres"),
  ]);
  const pool = new Pool({ connectionString: url });
  await bootstrapPg({
    query: async (sql: string) => {
      await pool.query(sql);
    },
  });
  const db = drizzle(pool, { schema: pgSchema });
  return {
    db,
    close: async (): Promise<void> => {
      await pool.end();
    },
  };
}

export async function openPgliteDb(dataDir?: string): Promise<PgHandle> {
  const [{ PGlite }, { drizzle }] = await Promise.all([
    import("@electric-sql/pglite"),
    import("drizzle-orm/pglite"),
  ]);
  const client = dataDir ? new PGlite(dataDir) : new PGlite();
  await client.waitReady;
  await bootstrapPg({
    query: async (sql: string) => {
      await client.exec(sql);
    },
  });
  const db = drizzle(client, { schema: pgSchema });
  return {
    db,
    close: async (): Promise<void> => {
      await client.close();
    },
  };
}
