import { error } from "@sveltejs/kit";
import { repo } from "$lib/server/db";
import { loadDecisions, loadProject } from "$lib/server/queries";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params }) => {
  const r = await repo();
  const project = await loadProject(r, params.slug);
  if (!project) throw error(404, `No helm project with slug "${params.slug}".`);
  const items = await loadDecisions(r, project.id, 100);
  return {
    decisions: items.map((d) => ({
      id: d.id,
      title: d.title,
      context: d.context,
      decision: d.decision,
      status: d.status,
      decidedAt: d.decidedAt,
    })),
  };
};
