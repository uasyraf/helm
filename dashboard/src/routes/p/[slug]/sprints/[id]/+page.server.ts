import { error } from "@sveltejs/kit";
import { repo } from "$lib/server/db";
import {
  computeSprintMetric,
  loadEventsForSprint,
  loadProject,
  loadSprintById,
  loadStoriesInSprint,
} from "$lib/server/queries";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params }) => {
  const r = await repo();
  const project = await loadProject(r, params.slug);
  if (!project) throw error(404, `No helm project with slug "${params.slug}".`);
  const sprint = await loadSprintById(r, params.id);
  if (!sprint || sprint.projectId !== project.id) throw error(404, `Sprint ${params.id} not found`);
  const metric = await computeSprintMetric(r, sprint);
  const stories = await loadStoriesInSprint(r, sprint.id);
  const events = await loadEventsForSprint(r, sprint.id, 100);

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
