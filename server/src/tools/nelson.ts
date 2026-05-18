import { z } from "zod";
import type { ToolRegistrar } from "./types.js";
import { jsonResult } from "./types.js";
import { emitEvent } from "../events/emit.js";

export const registerNelsonTools: ToolRegistrar = (server, ctx) => {
  server.registerTool(
    "link_mission",
    {
      title: "Link a Nelson mission to a story/sprint",
      description: "Called by Nelson's Step 3 (Battle Plan approved). Creates a mission.linked progress event.",
      inputSchema: {
        missionId: z.string().min(1),
        storyId: z.string().optional(),
        sprintId: z.string().optional(),
        summary: z.string().optional(),
      },
    },
    async (args) => {
      const { repo, session } = ctx;
      const sprintId = args.sprintId ?? session.activeSprint.id;
      await emitEvent(repo, {
        projectId: session.project.id,
        developerId: session.developer.id,
        sprintId,
        kind: "mission.linked",
        refId: args.missionId,
        summary: args.summary ?? `mission ${args.missionId} linked${args.storyId ? ` to story ${args.storyId}` : ""}`,
      });
      return jsonResult({ missionId: args.missionId, storyId: args.storyId ?? null, sprintId });
    },
  );
};
