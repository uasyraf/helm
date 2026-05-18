import { activeSlug, repo } from "$lib/server/db";
import {
  computeSprintMetric,
  loadActiveSprint,
  loadOpenDebt,
  loadProject,
  loadRecentEvents,
} from "$lib/server/queries";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async () => {
  const r = await repo();
  const project = (await loadProject(r, activeSlug()))!;
  const activeSprint = await loadActiveSprint(r, project.id);
  const metric = activeSprint ? await computeSprintMetric(r, activeSprint) : null;
  const topDebt = await loadOpenDebt(r, project.id, 5);
  const events = await loadRecentEvents(r, project.id, 15);

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
