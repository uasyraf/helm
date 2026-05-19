import { redirect } from "@sveltejs/kit";
import { defaultSlug, repo } from "$lib/server/db";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async () => {
  const r = await repo();
  const projects = await r.findAllProjects();
  const want = defaultSlug();
  if (want && projects.some((p) => p.slug === want)) {
    throw redirect(307, `/p/${want}/`);
  }
  return {
    projects: projects.map((p) => ({
      slug: p.slug,
      name: p.name,
      sprintLengthDays: p.sprintLengthDays,
    })),
  };
};
