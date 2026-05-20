import { fail, redirect } from "@sveltejs/kit";
import { isRemoteMode, remoteRepo, repo } from "$lib/server/db";
import { RemoteHttpError } from "$lib/server/remote-repo";
import type { Actions } from "./$types";

const SLUG_RE = /^[a-z0-9._-]+$/;

interface FailShape {
  error: string;
  values: { slug: string };
}

function badInput(message: string, values: FailShape["values"]) {
  return fail(400, { error: message, values } satisfies FailShape);
}

export const actions: Actions = {
  default: async ({ request }) => {
    const data = await request.formData();
    const slug = String(data.get("slug") ?? "").trim();
    const values = { slug };

    if (!slug) return badInput("slug is required", values);
    if (!SLUG_RE.test(slug)) {
      return badInput("slug must match [a-z0-9._-]+", values);
    }

    try {
      if (isRemoteMode()) {
        const remote = await remoteRepo();
        // Result distinguishes fresh (201) vs already-member (200) but for the
        // dashboard the UX collapses to "land on the project page either way".
        await remote.joinProject(slug);
      } else {
        // Local mode: there is no membership concept. If the project exists,
        // every dashboard request can already read it. Treat join as a
        // glorified redirect — but verify existence first so we don't 303
        // into a 404.
        const r = await repo();
        const existing = await r.findProjectBySlug(slug);
        if (!existing) {
          return fail(404, {
            error: `no project '${slug}' on this helm`,
            values,
          } satisfies FailShape);
        }
      }
    } catch (err) {
      if (err instanceof RemoteHttpError) {
        return fail(err.status >= 400 && err.status < 500 ? err.status : 500, {
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
