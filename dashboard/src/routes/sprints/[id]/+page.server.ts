import { error } from "@sveltejs/kit";
import { activeSlug, db } from "$lib/server/db";
import {
  computeSprintMetric,
  loadEventsForSprint,
  loadProject,
  loadSprintById,
  loadStoriesInSprint,
} from "$lib/server/queries";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params }) => {
  const handle = db();
  await loadProject(handle, activeSlug());
  const sprint = await loadSprintById(handle, params.id);
  if (!sprint) throw error(404, `Sprint ${params.id} not found`);
  const metric = await computeSprintMetric(handle, sprint);
  const stories = await loadStoriesInSprint(handle, sprint.id);
  const events = await loadEventsForSprint(handle, sprint.id, 100);

  return {
    sprint: {
      id: sprint.id,
      name: sprint.name,
      goal: sprint.goal,
      status: sprint.status,
      startedAt: sprint.startedAt,
      endedAt: sprint.endedAt,
    },
    metric,
    stories: stories.map((s) => ({
      id: s.id,
      title: s.title,
      status: s.status,
      size: s.size,
      priority: s.priority,
    })),
    events: events.map((e) => ({ id: e.id, ts: e.ts, kind: e.kind, summary: e.summary })),
  };
};
