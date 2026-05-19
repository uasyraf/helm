export interface PgQueryRunner {
  query: (sql: string) => Promise<unknown>;
}

const STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS project (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    git_remote TEXT,
    dod TEXT,
    sprint_length_days INTEGER NOT NULL DEFAULT 14,
    wip_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    estimation_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS developer (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES project(id),
    handle TEXT NOT NULL,
    email TEXT,
    oidc_sub TEXT,
    last_seen_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sprint (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES project(id),
    name TEXT NOT NULL,
    goal TEXT,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    status TEXT NOT NULL,
    wip_limit INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS epic (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES project(id),
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    priority INTEGER NOT NULL DEFAULT 3,
    target_sprint_id TEXT REFERENCES sprint(id),
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS story (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES project(id),
    epic_id TEXT REFERENCES epic(id),
    sprint_id TEXT REFERENCES sprint(id),
    title TEXT NOT NULL,
    description TEXT,
    acceptance TEXT,
    status TEXT NOT NULL DEFAULT 'backlog',
    size TEXT,
    assignee_id TEXT REFERENCES developer(id),
    priority INTEGER NOT NULL DEFAULT 3,
    started_at TEXT,
    completed_at TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS task (
    id TEXT PRIMARY KEY,
    story_id TEXT NOT NULL REFERENCES story(id),
    assignee_id TEXT REFERENCES developer(id),
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'todo',
    blocked_by TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS tech_debt (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES project(id),
    title TEXT NOT NULL,
    description TEXT,
    severity TEXT NOT NULL DEFAULT 'med',
    location TEXT,
    owner_id TEXT REFERENCES developer(id),
    expires_at TEXT,
    opened_at TEXT NOT NULL,
    closed_at TEXT,
    linked_story_id TEXT REFERENCES story(id)
  )`,
  `CREATE TABLE IF NOT EXISTS decision (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES project(id),
    title TEXT NOT NULL,
    context TEXT,
    decision TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'accepted',
    decided_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS progress_event (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES project(id),
    developer_id TEXT REFERENCES developer(id),
    sprint_id TEXT REFERENCES sprint(id),
    kind TEXT NOT NULL,
    ref_id TEXT,
    summary TEXT NOT NULL,
    user_sub TEXT,
    ts TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS schema_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_progress_event_ts ON progress_event(ts DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_progress_event_project_ts ON progress_event(project_id, ts DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_developer_oidc ON developer(project_id, oidc_sub)`,
  `CREATE INDEX IF NOT EXISTS idx_story_sprint ON story(sprint_id)`,
  `CREATE INDEX IF NOT EXISTS idx_story_status ON story(status)`,
  `CREATE INDEX IF NOT EXISTS idx_story_project ON story(project_id)`,
  `CREATE INDEX IF NOT EXISTS idx_tech_debt_closed ON tech_debt(closed_at)`,
];

const MIGRATIONS: readonly string[] = [
  `ALTER TABLE story ADD COLUMN IF NOT EXISTS project_id TEXT REFERENCES project(id)`,
  `UPDATE story SET project_id = COALESCE(
     (SELECT s.project_id FROM sprint s WHERE s.id = story.sprint_id),
     (SELECT e.project_id FROM epic e WHERE e.id = story.epic_id),
     (SELECT p.id FROM project p ORDER BY p.created_at LIMIT 1)
   )
   WHERE project_id IS NULL`,
  `ALTER TABLE developer ADD COLUMN IF NOT EXISTS oidc_sub TEXT`,
  `ALTER TABLE progress_event ADD COLUMN IF NOT EXISTS user_sub TEXT`,
  `CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_developer_oidc ON developer(project_id, oidc_sub)`,
  `CREATE INDEX IF NOT EXISTS idx_progress_event_project_ts ON progress_event(project_id, ts DESC)`,
];

export const SCHEMA_VERSION_PG = "2";

export async function bootstrapPg(runner: PgQueryRunner): Promise<void> {
  for (const sql of STATEMENTS) {
    await runner.query(sql);
  }
  for (const sql of MIGRATIONS) {
    await runner.query(sql);
  }
  await runner.query(
    `INSERT INTO schema_meta(key, value) VALUES('version', '${SCHEMA_VERSION_PG}') ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value`,
  );
}
