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
      // claim ∪ membership: claim covers OR admin → proceed; else fall back to membership;
      // else, if project.openJoin → return structured JOIN_REQUIRED; else bare FORBIDDEN.
      // `allowed === undefined` is the HELM_API_TOKEN single-tenant fallback path
      // (no OIDC claim available) — treat it as "all" for symmetry with
      // list_accessible_projects (F3: previously regressed to FORBIDDEN/JOIN_REQUIRED).
      const claimCovers =
        allowed === "all" || allowed === undefined || allowed.has(args.slug);
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
      if (!claimCovers) {
        const userSub = ctx.identity?.userSub ?? null;
        const member = userSub ? await ctx.repo.findProjectMember(project.id, userSub) : null;
        if (!member) {
          if (project.openJoin === true) {
            return {
              isError: true,
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({
                    error: {
                      code: "JOIN_REQUIRED",
                      message: `project '${args.slug}' is open to join — call POST /v1/projects/${args.slug}/join or invoke the dashboard /join flow`,
                      joinable: { slug: project.slug, name: project.name, open_join: true },
                    },
                  }),
                },
              ],
            };
          }
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
