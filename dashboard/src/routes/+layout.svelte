<script lang="ts">
  import "../app.css";
  import { page } from "$app/state";

  interface Props {
    data: { project: { slug: string; name: string } };
    children: import("svelte").Snippet;
  }

  let { data, children }: Props = $props();

  const links = [
    { href: "/", label: "Home" },
    { href: "/debt", label: "Debt" },
    { href: "/sprints", label: "Sprints" },
    { href: "/decisions", label: "Decisions" },
  ];

  function isActive(href: string): boolean {
    if (href === "/") return page.url.pathname === "/";
    return page.url.pathname.startsWith(href);
  }
</script>

<div class="layout">
  <header class="nav">
    <span class="brand">helm</span>
    <span class="muted mono">{data.project.slug}</span>
    <nav>
      {#each links as link}
        <a href={link.href} class={isActive(link.href) ? "active" : ""}>{link.label}</a>
      {/each}
    </nav>
  </header>
  {@render children()}
</div>
