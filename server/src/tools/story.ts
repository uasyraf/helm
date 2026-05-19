import { z } from "zod";
import type { ToolRegistrar } from "./types.js";
import { jsonResult } from "./types.js";
import { newId, now } from "../util/ids.js";
import { emitEvent } from "../events/emit.js";
import type { StoryUpdate } from "../db/repo.js";

const STORY_STATUS = z.enum(["backlog", "todo", "doing", "review", "done", "dropped"]);
const SIZE = z.enum(["XS", "S", "M", "L", "XL", "XXL"]);

export const registerStoryTools: ToolRegistrar = (server, ctx) => {
  server.registerTool(
    "open_story",
    {
      title: "Open a new story",
      description: "Create a user-valued increment. Optionally attach to an epic or sprint; default lands in backlog.",
      inputSchema: {
        title: z.string().min(1),
        description: z.string().optional(),
        acceptance: z.string().optional(),
        epicId: z.string().optional(),
        sprintId: z.string().optional(),
        size: SIZE.optional(),
        priority: z.number().int().min(1).max(5).optional(),
        assigneeId: z.string().optional(),
      },
    },
    async (args) => {
      const { repo, session } = ctx;
      const id = newId();
      const initialStatus = args.sprintId ? "todo" : "backlog";
      await repo.insertStory({
        id,
        projectId: session.project.id,
        epicId: args.epicId ?? null,
        sprintId: args.sprintId ?? null,
        title: args.title,
        description: args.description ?? null,
        acceptance: args.acceptance ?? null,
        status: initialStatus,
        size: args.size ?? null,
        assigneeId: args.assigneeId ?? null,
        priority: args.priority ?? 3,
        startedAt: null,
        completedAt: null,
        createdAt: now(),
      });
      await emitEvent(repo, {
        projectId: session.project.id,
        developerId: session.developer.id,
        sprintId: args.sprintId ?? session.activeSprint.id,
        kind: "story.opened",
        refId: id,
        summary: `story: ${args.title}`,
      });
      return jsonResult({ id, title: args.title, status: initialStatus, sprintId: args.sprintId ?? null });
    },
  );

  server.registerTool(
    "update_story",
    {
      title: "Update a story",
      description: "Edit any mutable field. Status transitions to doing/review/done emit timeline events.",
      inputSchema: {
        id: z.string(),
        title: z.string().optional(),
        description: z.string().optional(),
        acceptance: z.string().optional(),
        status: STORY_STATUS.optional(),
        size: SIZE.optional(),
        priority: z.number().int().min(1).max(5).optional(),
        assigneeId: z.string().optional(),
        epicId: z.string().optional(),
      },
    },
    async (args) => {
      const { repo, session } = ctx;
      const updates: StoryUpdate = {};
      if (args.title !== undefined) updates.title = args.title;
      if (args.description !== undefined) updates.description = args.description;
      if (args.acceptance !== undefined) updates.acceptance = args.acceptance;
      if (args.status !== undefined) updates.status = args.status;
      if (args.size !== undefined) updates.size = args.size;
      if (args.priority !== undefined) updates.priority = args.priority;
      if (args.assigneeId !== undefined) updates.assigneeId = args.assigneeId;
      if (args.epicId !== undefined) updates.epicId = args.epicId;
      if (args.status === "doing") updates.startedAt = now();
      if (Object.keys(updates).length === 0) return jsonResult({ id: args.id, changed: false });

      await repo.updateStory(args.id, updates);
      await emitEvent(repo, {
        projectId: session.project.id,
        developerId: session.developer.id,
        sprintId: session.activeSprint.id,
        kind: "story.updated",
        refId: args.id,
        summary: `story updated: ${Object.keys(updates).join(", ")}`,
      });
      return jsonResult({ id: args.id, changed: true, updates });
    },
  );

  server.registerTool(
    "move_story",
    {
      title: "Move a story to a sprint or back to backlog",
      description: "Pass sprintId to move into a sprint, or null to send to backlog.",
      inputSchema: {
        id: z.string(),
        sprintId: z.string().nullable().describe("null to send to backlog"),
      },
    },
    async (args) => {
      const { repo, session } = ctx;
      const newStatus = args.sprintId ? "todo" : "backlog";
      await repo.updateStory(args.id, { sprintId: args.sprintId, status: newStatus });
      await emitEvent(repo, {
        projectId: session.project.id,
        developerId: session.developer.id,
        sprintId: args.sprintId ?? session.activeSprint.id,
        kind: "story.moved",
        refId: args.id,
        summary: args.sprintId ? `story moved to sprint ${args.sprintId}` : `story moved to backlog`,
      });
      return jsonResult({ id: args.id, sprintId: args.sprintId, status: newStatus });
    },
  );

  server.registerTool(
    "close_story",
    {
      title: "Close a story",
      description: "Marks done (or dropped). Sets completed_at.",
      inputSchema: {
        id: z.string(),
        dropped: z.boolean().optional(),
      },
    },
    async (args) => {
      const { repo, session } = ctx;
      const status = args.dropped ? "dropped" : "done";
      await repo.updateStory(args.id, { status, completedAt: now() });
      await emitEvent(repo, {
        projectId: session.project.id,
        developerId: session.developer.id,
        sprintId: session.activeSprint.id,
        kind: "story.closed",
        refId: args.id,
        summary: `story ${status}`,
      });
      return jsonResult({ id: args.id, status });
    },
  );

  server.registerTool(
    "list_backlog",
    {
      title: "List backlog stories",
      description: "Stories not assigned to a sprint, ordered by priority then creation time.",
      inputSchema: {
        limit: z.number().int().positive().max(200).optional(),
      },
    },
    async (args) => {
      const { repo, session } = ctx;
      const rows = await repo.findBacklogStories(session.project.id, args.limit ?? 50);
      return jsonResult({
        count: rows.length,
        stories: rows.map((r) => ({ id: r.id, title: r.title, priority: r.priority, size: r.size })),
      });
    },
  );
};
