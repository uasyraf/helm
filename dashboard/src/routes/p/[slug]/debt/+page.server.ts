import { error } from "@sveltejs/kit";
import { repo } from "$lib/server/db";
import { loadAllDebt, loadProject } from "$lib/server/queries";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params }) => {
  const r = await repo();
  const project = await loadProject(r, params.slug);
  if (!project) throw error(404, `No helm project with slug "${params.slug}".`);
  const items = await loadAllDebt(r, project.id, 500);
  return {
    debt: items.map((d) => ({
      id: d.id,
      title: d.title,
      description: d.description,
      severity: d.severity,
      location: d.location,
      openedAt: d.openedAt,
      closedAt: d.closedAt,
      expiresAt: d.expiresAt,
    })),
  };
};
