import { error } from "@sveltejs/kit";
import { activeSlug, db } from "$lib/server/db";
import { loadProject } from "$lib/server/queries";
import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = async () => {
  let slug: string;
  try {
    slug = activeSlug();
  } catch (err) {
    throw error(500, (err as Error).message);
  }

  const project = await loadProject(db(), slug);
  if (!project) {
    throw error(404, `No helm project with slug "${slug}". Did you run any MCP tools yet?`);
  }
  return {
    project: { slug: project.slug, name: project.name },
  };
};
