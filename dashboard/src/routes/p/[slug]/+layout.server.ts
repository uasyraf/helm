import { error } from "@sveltejs/kit";
import { repo } from "$lib/server/db";
import { loadProject } from "$lib/server/queries";
import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = async ({ params }) => {
  const project = await loadProject(await repo(), params.slug);
  if (!project) {
    throw error(404, `No helm project with slug "${params.slug}".`);
  }
  return {
    project: { id: project.id, slug: project.slug, name: project.name, sprintLengthDays: project.sprintLengthDays },
  };
};
