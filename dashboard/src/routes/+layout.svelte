<script lang="ts">
  import "../app.css";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";

  interface Props {
    data: { projects: { slug: string; name: string }[]; defaultSlug: string | null };
    children: import("svelte").Snippet;
  }

  let { data, children }: Props = $props();

  const currentSlug = $derived.by(() => {
    const m = page.url.pathname.match(/^\/p\/([^/]+)/);
    return m ? m[1] : "";
  });

  function onSwitch(event: Event): void {
    const target = event.currentTarget as HTMLSelectElement;
    const slug = target.value;
    if (!slug) return;
    void goto(`/p/${slug}/`);
  }
</script>

<div class="layout">
  <header class="nav">
    <a href="/" class="brand" style="text-decoration: none; color: inherit;">helm</a>
    <nav>
      <a href="/create" class:active={page.url.pathname === "/create"}>Create</a>
      <a href="/join" class:active={page.url.pathname === "/join"}>Join</a>
    </nav>
    {#if data.projects.length > 0}
      <select class="mono" onchange={onSwitch} value={currentSlug}>
        <option value="">— pick a project —</option>
        {#each data.projects as p}
          <option value={p.slug}>{p.name} ({p.slug})</option>
        {/each}
      </select>
    {/if}
  </header>
  {@render children()}
</div>
