import { activeSlug, db } from "$lib/server/db";
import { loadAllDebt, loadProject } from "$lib/server/queries";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async () => {
  const handle = db();
  const project = (await loadProject(handle, activeSlug()))!;
  const items = await loadAllDebt(handle, project.id, 500);
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
