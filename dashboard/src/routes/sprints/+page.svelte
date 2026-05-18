<script lang="ts">
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  const maxVelocity = $derived(Math.max(1, ...data.metrics.map((m) => m.storiesDone)));

  function deltaClass(n: number): string {
    if (n > 0) return "delta-positive";
    if (n < 0) return "delta-negative";
    return "delta-zero";
  }

  function deltaLabel(n: number): string {
    return n > 0 ? `+${n}` : `${n}`;
  }
</script>

<div class="card">
  <h2>Velocity (stories done per sprint)</h2>
  {#if data.metrics.length === 0}
    <div class="empty">No sprints yet.</div>
  {:else}
    <svg viewBox="0 0 {Math.max(data.metrics.length * 60, 240)} 140" style="width: 100%; height: 140px;">
      {#each data.metrics.slice().reverse() as m, i}
        {@const barHeight = (m.storiesDone / maxVelocity) * 100}
        <g transform="translate({i * 60 + 20}, 0)">
          <rect
            x="0"
            y={120 - barHeight}
            width="40"
            height={barHeight}
            fill="var(--accent)"
            opacity={m.status === "active" ? 1 : 0.5}
          />
          <text x="20" y="135" text-anchor="middle" font-size="10" fill="var(--muted)" class="mono">{m.name}</text>
          <text x="20" y={114 - barHeight} text-anchor="middle" font-size="11" fill="var(--fg)" font-weight="600">{m.storiesDone}</text>
        </g>
      {/each}
    </svg>
  {/if}
</div>

<div class="card">
  <h2>All sprints</h2>
  {#if data.metrics.length === 0}
    <div class="empty">No sprints yet.</div>
  {:else}
    <table>
      <thead>
        <tr>
          <th>Sprint</th>
          <th>Status</th>
          <th>Stories</th>
          <th>Debt delta</th>
          <th>Started</th>
          <th>Ended</th>
        </tr>
      </thead>
      <tbody>
        {#each data.metrics as m}
          <tr>
            <td><a href="/sprints/{m.sprintId}" class="mono">{m.name}</a></td>
            <td><span class="pill status-{m.status}">{m.status}</span></td>
            <td>{m.storiesDone}/{m.storiesTotal}</td>
            <td class={deltaClass(m.debtDelta)}>{deltaLabel(m.debtDelta)}</td>
            <td class="muted">{new Date(m.startedAt).toLocaleDateString()}</td>
            <td class="muted">{m.endedAt ? new Date(m.endedAt).toLocaleDateString() : "—"}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>
