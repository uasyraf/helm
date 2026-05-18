import { activeSlug, db } from "$lib/server/db";
import { loadDecisions, loadProject } from "$lib/server/queries";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async () => {
  const handle = db();
  const project = (await loadProject(handle, activeSlug()))!;
  const items = await loadDecisions(handle, project.id, 100);
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
