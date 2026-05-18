<script lang="ts">
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  function deltaClass(n: number): string {
    if (n > 0) return "delta-positive";
    if (n < 0) return "delta-negative";
    return "delta-zero";
  }

  function deltaLabel(n: number): string {
    return n > 0 ? `+${n}` : `${n}`;
  }

  function formatTs(ts: string): string {
    const d = new Date(ts);
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  }
</script>

<div class="card">
  <h2>{data.sprint.name} <span class="pill status-{data.sprint.status}" style="margin-left: 8px;">{data.sprint.status}</span></h2>
  {#if data.sprint.goal}
    <p style="margin: 8px 0;">{data.sprint.goal}</p>
  {/if}
  <div class="muted" style="margin-top: 4px;">
    {new Date(data.sprint.startedAt).toLocaleDateString()}
    {#if data.sprint.endedAt} → {new Date(data.sprint.endedAt).toLocaleDateString()}{/if}
  </div>
</div>

<div class="row">
  <div class="card">
    <h2>Stories</h2>
    <div class="metric">{data.metric.storiesDone}<span class="muted" style="font-size: 24px;">/{data.metric.storiesTotal}</span></div>
    <div class="muted" style="margin-top: 8px;">completed</div>
  </div>
  <div class="card">
    <h2>Debt delta</h2>
    <div class="metric {deltaClass(data.metric.debtDelta)}">{deltaLabel(data.metric.debtDelta)}</div>
    <div class="muted" style="margin-top: 8px;">
      <span style="color: var(--danger);">+{data.metric.debtOpened}</span> opened ·
      <span style="color: var(--ok);">−{data.metric.debtClosed}</span> closed
    </div>
  </div>
</div>

<div class="card">
  <h2>Stories in sprint</h2>
  {#if data.stories.length === 0}
    <div class="empty">No stories pulled into this sprint.</div>
  {:else}
    <table>
      <thead>
        <tr>
          <th>Title</th>
          <th>Status</th>
          <th>Size</th>
          <th>Priority</th>
        </tr>
      </thead>
      <tbody>
        {#each data.stories as s}
          <tr>
            <td>{s.title}</td>
            <td><span class="pill status-{s.status}">{s.status}</span></td>
            <td class="muted">{s.size ?? "—"}</td>
            <td class="muted">P{s.priority}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>

<div class="card">
  <h2>Timeline</h2>
  {#if data.events.length === 0}
    <div class="empty">No events.</div>
  {:else}
    <table>
      <thead>
        <tr>
          <th style="width: 160px;">When</th>
          <th style="width: 160px;">Kind</th>
          <th>Summary</th>
        </tr>
      </thead>
      <tbody>
        {#each data.events as e}
          <tr>
            <td class="muted">{formatTs(e.ts)}</td>
            <td class="mono muted">{e.kind}</td>
            <td>{e.summary}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>
