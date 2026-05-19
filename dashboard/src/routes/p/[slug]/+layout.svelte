<script lang="ts">
  import { page } from "$app/state";

  interface Props {
    data: { project: { slug: string; name: string } };
    children: import("svelte").Snippet;
  }

  let { data, children }: Props = $props();

  const slug = $derived(data.project.slug);
  const links = $derived([
    { href: `/p/${slug}/`, label: "Home", exact: true },
    { href: `/p/${slug}/debt`, label: "Debt", exact: false },
    { href: `/p/${slug}/sprints`, label: "Sprints", exact: false },
    { href: `/p/${slug}/decisions`, label: "Decisions", exact: false },
  ]);

  function isActive(href: string, exact: boolean): boolean {
    if (exact) return page.url.pathname === href;
    return page.url.pathname.startsWith(href);
  }
</script>

<nav class="subnav">
  {#each links as link}
    <a href={link.href} class={isActive(link.href, link.exact) ? "active" : ""}>{link.label}</a>
  {/each}
</nav>
{@render children()}
