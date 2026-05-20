import { z } from "zod";
import type { HelmRepo } from "../db/repo.js";
import type { Project } from "../db/schema.js";
import { emitEvent } from "../events/emit.js";
import { newId, now } from "../util/ids.js";

// Reserved slugs collide with helm's routing surface or read like
// platform-owned namespaces. Operator-configurable denylist is deferred
// (see F5-min in the T3+T4 red-cell review).
export const RESERVED_SLUGS = new Set([
  "admin",
  "api",
  "v1",
  "mcp",
  "helm",
  "well-known",
  ".",
  "..",
]);

export const ProjectSlugSchema = z
  .string()
  .min(3, "slug must be at least 3 characters")
  .max(64, "slug must be at most 64 characters")
  .regex(/^[a-z0-9._-]+$/, "slug may only contain lowercase letters, digits, '.', '_', '-'")
  .refine((s) => /[a-z0-9]/.test(s), {
    message: "slug must contain at least one alphanumeric character",
  })
  .refine((s) => !RESERVED_SLUGS.has(s), {
    message: "slug is reserved and cannot be used",
  });

export const CreateProjectSchema = z.object({
  slug: ProjectSlugSchema,
  name: z.string().min(1).optional(),
  gitRemote: z.string().optional(),
  sprintLengthDays: z.number().int().positive().optional(),
});

export type CreateProjectInput = z.infer<typeof CreateProjectSchema>;

export type ProvisioningErrorCode =
  | "VALIDATION_FAILED"
  | "UNAUTHORIZED"
  | "CONFLICT"
  | "NOT_FOUND"
  | "FORBIDDEN";

export type ProvisioningResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: ProvisioningErrorCode; message: string; details?: unknown };

export interface ProvisioningActor {
  userSub: string | null;
}

export interface JoinResult {
  slug: string;
  role: "owner" | "member";
  alreadyMember: boolean;
}

function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: unknown; message?: unknown };
  if (typeof e.code === "string") {
    if (e.code === "23505") return true;
    if (e.code === "SQLITE_CONSTRAINT_PRIMARYKEY") return true;
    if (e.code === "SQLITE_CONSTRAINT_UNIQUE") return true;
    if (e.code === "SQLITE_CONSTRAINT") return true;
  }
  if (typeof e.message === "string") {
    const m = e.message.toUpperCase();
    if (m.includes("UNIQUE CONSTRAINT")) return true;
    if (m.includes("PRIMARY KEY")) return true;
    if (m.includes("DUPLICATE KEY")) return true;
  }
  return false;
}

export async function createProject(
  repo: HelmRepo,
  actor: ProvisioningActor,
  rawInput: unknown,
): Promise<ProvisioningResult<Project>> {
  if (!actor.userSub) {
    return { ok: false, code: "UNAUTHORIZED", message: "authenticated identity required" };
  }
  const parsed = CreateProjectSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      code: "VALIDATION_FAILED",
      message: "invalid project input",
      details: parsed.error.format(),
    };
  }
  const input = parsed.data;
  const existing = await repo.findProjectBySlug(input.slug);
  if (existing) {
    return { ok: false, code: "CONFLICT", message: `project '${input.slug}' already exists` };
  }
  const createdAt = now();
  const row: Project = {
    id: newId(),
    slug: input.slug,
    name: input.name ?? input.slug,
    gitRemote: input.gitRemote ?? null,
    dod: null,
    sprintLengthDays: input.sprintLengthDays ?? 14,
    wipEnabled: false,
    estimationEnabled: true,
    openJoin: true,
    createdAt,
  };
  await repo.insertProject(row);
  await repo.insertProjectMember({
    projectId: row.id,
    userSub: actor.userSub,
    role: "owner",
    createdAt,
  });
  // Audit: friendly provisioning means any authenticated user can create
  // a project — the timeline must record who. developerId stays null;
  // the creator's per-project developer row materializes on first scoped access.
  await emitEvent(repo, {
    projectId: row.id,
    developerId: null,
    sprintId: null,
    kind: "project.created",
    refId: row.id,
    summary: `project '${row.slug}' created`,
    userSub: actor.userSub,
  });
  return { ok: true, value: row };
}

export async function joinProject(
  repo: HelmRepo,
  actor: ProvisioningActor,
  slug: string,
): Promise<ProvisioningResult<JoinResult>> {
  if (!actor.userSub) {
    return { ok: false, code: "UNAUTHORIZED", message: "authenticated identity required" };
  }
  const project = await repo.findProjectBySlug(slug);
  if (!project) {
    return { ok: false, code: "NOT_FOUND", message: `project '${slug}' not found` };
  }
  if (project.openJoin !== true) {
    return {
      ok: false,
      code: "FORBIDDEN",
      message: `project '${slug}' is not open to join`,
    };
  }
  const existing = await repo.findProjectMember(project.id, actor.userSub);
  if (existing) {
    return {
      ok: true,
      value: { slug: project.slug, role: existing.role, alreadyMember: true },
    };
  }
  try {
    await repo.insertProjectMember({
      projectId: project.id,
      userSub: actor.userSub,
      role: "member",
      createdAt: now(),
    });
  } catch (err) {
    // TOCTOU: two concurrent joins can both pass findProjectMember; the
    // composite PK rejects the loser. Treat unique-violation as idempotent —
    // skip the audit emission since the winner already emitted project.joined.
    if (isUniqueViolation(err)) {
      const after = await repo.findProjectMember(project.id, actor.userSub);
      return {
        ok: true,
        value: { slug: project.slug, role: after?.role ?? "member", alreadyMember: true },
      };
    }
    throw err;
  }
  await emitEvent(repo, {
    projectId: project.id,
    developerId: null,
    sprintId: null,
    kind: "project.joined",
    refId: project.id,
    summary: `user joined project '${project.slug}'`,
    userSub: actor.userSub,
  });
  return {
    ok: true,
    value: { slug: project.slug, role: "member", alreadyMember: false },
  };
}
