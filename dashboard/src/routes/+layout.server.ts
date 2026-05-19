import { defaultSlug, repo } from "$lib/server/db";
import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = async () => {
  const r = await repo();
  const projects = await r.findAllProjects();
  return {
    projects: projects.map((p) => ({ slug: p.slug, name: p.name })),
    defaultSlug: defaultSlug(),
  };
};
