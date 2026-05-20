<script lang="ts">
  import type { ActionData } from "./$types";

  let { form }: { form: ActionData } = $props();

  const values = $derived(form?.values ?? { slug: "" });
</script>

<div class="card">
  <h2>Join project</h2>
  <p class="muted">
    Adds you as a member of an existing open-join project. The project owner must have left it open
    to join (the default). If you already belong, you'll land on the project page either way.
  </p>

  {#if form?.error}
    <div class="card" style="border-color: var(--danger); color: var(--danger); margin-top: 12px;">
      {form.error}
    </div>
  {/if}

  <form method="POST" style="display: grid; gap: 12px; max-width: 480px; margin-top: 16px;">
    <label style="display: grid; gap: 4px;">
      <span class="label">Slug</span>
      <input
        type="text"
        name="slug"
        required
        pattern="[a-z0-9._\-]+"
        autocomplete="off"
        value={values.slug}
        placeholder="project-slug"
        class="mono"
        style="padding: 6px 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--card); color: var(--fg);"
      />
    </label>

    <div>
      <button
        type="submit"
        style="padding: 8px 16px; border: 1px solid var(--accent); background: var(--accent); color: white; border-radius: 6px; cursor: pointer; font-weight: 600;"
      >
        Join project
      </button>
    </div>
  </form>
</div>
