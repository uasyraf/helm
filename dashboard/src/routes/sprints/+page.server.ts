import { activeSlug, db } from "$lib/server/db";
import { loadProject, loadSprintMetrics } from "$lib/server/queries";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async () => {
  const handle = db();
  const project = (await loadProject(handle, activeSlug()))!;
  const metrics = await loadSprintMetrics(handle, project.id);
  return { metrics };
};
