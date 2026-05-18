import { activeSlug, db } from "$lib/server/db";
import {
  computeSprintMetric,
  loadActiveSprint,
  loadOpenDebt,
  loadProject,
  loadRecentEvents,
} from "$lib/server/queries";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async () => {
  const handle = db();
  const project = (await loadProject(handle, activeSlug()))!;
  const activeSprint = await loadActiveSprint(handle, project.id);
  const metric = activeSprint ? await computeSprintMetric(handle, activeSprint) : null;
  const topDebt = await loadOpenDebt(handle, project.id, 5);
  const events = await loadRecentEvents(handle, project.id, 15);

  return {
    project: { id: project.id, name: project.name, slug: project.slug, sprintLengthDays: project.sprintLengthDays },
    activeSprint: activeSprint
      ? {
          id: activeSprint.id,
          name: activeSprint.name,
          goal: activeSprint.goal,
          startedAt: activeSprint.startedAt,
          status: activeSprint.status,
        }
      : null,
    metric,
    topDebt: topDebt.map((d) => ({
      id: d.id,
      title: d.title,
      severity: d.severity,
      location: d.location,
      openedAt: d.openedAt,
    })),
    events: events.map((e) => ({ id: e.id, ts: e.ts, kind: e.kind, summary: e.summary })),
  };
};
