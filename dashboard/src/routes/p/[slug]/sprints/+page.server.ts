import { error } from "@sveltejs/kit";
import { repo } from "$lib/server/db";
import { loadProject, loadSprintMetrics } from "$lib/server/queries";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params }) => {
  const r = await repo();
  const project = await loadProject(r, params.slug);
  if (!project) throw error(404, `No helm project with slug "${params.slug}".`);
  const metrics = await loadSprintMetrics(r, project.id);
  return { slug: project.slug, metrics };
};
