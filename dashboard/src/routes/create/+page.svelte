<script lang="ts">
  import type { ActionData } from "./$types";

  let { form }: { form: ActionData } = $props();

  const values = $derived(form?.values ?? { slug: "", name: "" });
</script>

<div class="card">
  <h2>Create project</h2>
  <p class="muted">
    Provisions a fresh project on this helm. The creator becomes the owner; the project starts open
    to join so teammates can self-serve.
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
        placeholder="my-project"
        class="mono"
        style="padding: 6px 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--card); color: var(--fg);"
      />
      <span class="muted" style="font-size: 12px;">Lowercase letters, digits, dot, dash, underscore.</span>
    </label>

    <label style="display: grid; gap: 4px;">
      <span class="label">Name (optional)</span>
      <input
        type="text"
        name="name"
        autocomplete="off"
        value={values.name}
        placeholder="defaults to the slug"
        style="padding: 6px 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--card); color: var(--fg);"
      />
    </label>

    <div>
      <button
        type="submit"
        style="padding: 8px 16px; border: 1px solid var(--accent); background: var(--accent); color: white; border-radius: 6px; cursor: pointer; font-weight: 600;"
      >
        Create project
      </button>
    </div>
  </form>
</div>
