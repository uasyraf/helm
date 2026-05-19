import { z } from "zod";
import type { ToolRegistrar } from "./types.js";
import { jsonResult } from "./types.js";
import { bootstrapSessionForProject } from "../project/bootstrap.js";

export const registerActiveProjectTools: ToolRegistrar = (server, ctx) => {
  server.registerTool(
    "set_active_project",
    {
      title: "Select the project for this MCP session",
      description:
        "Bind the current session to a project slug. Must be called once on remote MCP sessions before any other tool. Slug must appear in the caller's helm_projects claim (admins can target any project).",
      inputSchema: {
        slug: z.string().min(1),
      },
    },
    async (args) => {
      const allowed = ctx.allowedProjects;
      if (allowed && allowed !== "all" && !allowed.has(args.slug)) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: { code: "FORBIDDEN", message: `no access to project '${args.slug}'` },
              }),
            },
          ],
        };
      }
      const project = await ctx.repo.findProjectBySlug(args.slug);
      if (!project) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: { code: "NOT_FOUND", message: `project '${args.slug}' not found` },
              }),
            },
          ],
        };
      }
      const identity = ctx.identity ?? { handle: "anonymous", email: null, userSub: null };
      const next = await bootstrapSessionForProject(ctx.repo, args.slug, identity);
      ctx.session.project = next.project;
      ctx.session.developer = next.developer;
      ctx.session.activeSprint = next.activeSprint;
      ctx.session.warnings = next.warnings;
      ctx.session.pending = false;
      return jsonResult({
        project: { slug: project.slug, name: project.name },
        sprint: { id: next.activeSprint.id, name: next.activeSprint.name },
        developer: { id: next.developer.id, handle: next.developer.handle },
      });
    },
  );

  server.registerTool(
    "list_accessible_projects",
    {
      title: "List projects this caller can access",
      description: "Returns the set of project slugs the bearer token is authorized for, plus their existence in the tracker.",
      inputSchema: {},
    },
    async () => {
      const allowed = ctx.allowedProjects;
      const all = await ctx.repo.findAllProjects();
      const visible = allowed === "all" || allowed === undefined
        ? all
        : all.filter((p) => allowed.has(p.slug));
      return jsonResult({
        admin: ctx.isAdmin === true,
        projects: visible.map((p) => ({ slug: p.slug, name: p.name })),
      });
    },
  );
};

export const ALWAYS_AVAILABLE_TOOLS = new Set(["set_active_project", "list_accessible_projects"]);
