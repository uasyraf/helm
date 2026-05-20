import { fail, redirect } from "@sveltejs/kit";
import { isRemoteMode, repo } from "$lib/server/db";
import { RemoteHttpError } from "$lib/server/remote-repo";
import { newId, now } from "$helm/util/ids.js";
import type { Actions } from "./$types";

// Slug regex mirrors the REST contract in routes-projects.ts so client/server
// validation stay in sync.
const SLUG_RE = /^[a-z0-9._-]+$/;

interface FailShape {
  error: string;
  values: { slug: string; name: string };
}

function badInput(message: string, values: FailShape["values"]) {
  return fail(400, { error: message, values } satisfies FailShape);
}

export const actions: Actions = {
  default: async ({ request }) => {
    const data = await request.formData();
    const slug = String(data.get("slug") ?? "").trim();
    const name = String(data.get("name") ?? "").trim();
    const values = { slug, name };

    if (!slug) return badInput("slug is required", values);
    if (!SLUG_RE.test(slug)) {
      return badInput("slug must match [a-z0-9._-]+", values);
    }

    const r = await repo();

    try {
      if (isRemoteMode()) {
        await r.insertProject({
          id: "",
          slug,
          name: name || slug,
          gitRemote: null,
          dod: null,
          sprintLengthDays: 14,
          wipEnabled: false,
          estimationEnabled: true,
          openJoin: true,
          createdAt: "",
        });
      } else {
        // Local mode: dashboard is single-user-on-laptop, no auth context, no
        // membership rows. The REST handler inserts owner-membership in remote
        // mode; we skip it here on purpose. See captain's log for the asymmetry.
        const existing = await r.findProjectBySlug(slug);
        if (existing) {
          return fail(409, {
            error: `project '${slug}' already exists`,
            values,
          } satisfies FailShape);
        }
        await r.insertProject({
          id: newId(),
          slug,
          name: name || slug,
          gitRemote: null,
          dod: null,
          sprintLengthDays: 14,
          wipEnabled: false,
          estimationEnabled: true,
          openJoin: true,
          createdAt: now(),
        });
      }
    } catch (err) {
      if (err instanceof RemoteHttpError) {
        return fail(err.status === 401 || err.status === 403 ? err.status : 400, {
          error: err.message,
          values,
        } satisfies FailShape);
      }
      const message = err instanceof Error ? err.message : "unknown error";
      return fail(500, { error: message, values } satisfies FailShape);
    }

    throw redirect(303, `/p/${slug}/`);
  },
};
