<script lang="ts">
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();
  let filter = $state<"open" | "closed" | "all">("open");

  const filtered = $derived(
    data.debt.filter((d) => {
      if (filter === "open") return !d.closedAt;
      if (filter === "closed") return !!d.closedAt;
      return true;
    }),
  );

  function formatTs(ts: string | null): string {
    if (!ts) return "—";
    const d = new Date(ts);
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  }
</script>

<div class="card">
  <h2>Tech debt</h2>
  <div style="display: flex; gap: 8px; margin-bottom: 12px;">
    <button class="pill" style="cursor: pointer; background: {filter === 'open' ? 'var(--border)' : 'transparent'};" onclick={() => (filter = "open")}>
      Open
    </button>
    <button class="pill" style="cursor: pointer; background: {filter === 'closed' ? 'var(--border)' : 'transparent'};" onclick={() => (filter = "closed")}>
      Closed
    </button>
    <button class="pill" style="cursor: pointer; background: {filter === 'all' ? 'var(--border)' : 'transparent'};" onclick={() => (filter = "all")}>
      All
    </button>
    <span class="muted" style="margin-left: auto;">{filtered.length} item{filtered.length === 1 ? "" : "s"}</span>
  </div>
  {#if filtered.length === 0}
    <div class="empty">Nothing here.</div>
  {:else}
    <table>
      <thead>
        <tr>
          <th>Severity</th>
          <th>Title</th>
          <th>Location</th>
          <th>Opened</th>
          <th>Closed</th>
          <th>Expires</th>
        </tr>
      </thead>
      <tbody>
        {#each filtered as d}
          <tr>
            <td><span class="pill sev-{d.severity}">{d.severity}</span></td>
            <td>{d.title}</td>
            <td class="mono muted">{d.location ?? ""}</td>
            <td class="muted">{formatTs(d.openedAt)}</td>
            <td class="muted">{formatTs(d.closedAt)}</td>
            <td class="muted">{d.expiresAt ?? "—"}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>
