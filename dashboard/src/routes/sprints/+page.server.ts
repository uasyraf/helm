import { activeSlug, repo } from "$lib/server/db";
import { loadProject, loadSprintMetrics } from "$lib/server/queries";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async () => {
  const r = await repo();
  const project = (await loadProject(r, activeSlug()))!;
  const metrics = await loadSprintMetrics(r, project.id);
  return { metrics };
};
