<script lang="ts">
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  function sprintDay(startedAt: string): number {
    const start = Date.parse(startedAt);
    if (Number.isNaN(start)) return 1;
    return Math.max(1, Math.floor((Date.now() - start) / 86_400_000) + 1);
  }

  function deltaClass(n: number): string {
    if (n > 0) return "delta-positive";
    if (n < 0) return "delta-negative";
    return "delta-zero";
  }

  function deltaLabel(n: number): string {
    if (n > 0) return `+${n}`;
    return `${n}`;
  }

  function formatTs(ts: string): string {
    const d = new Date(ts);
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  }
</script>

<div class="row">
  <div class="card" style="flex: 2;">
    <h2>Active sprint</h2>
    {#if data.activeSprint && data.metric}
      <div style="display: flex; justify-content: space-between; align-items: baseline; gap: 24px;">
        <div>
          <div style="font-size: 22px; font-weight: 600;">{data.activeSprint.name}</div>
          <div class="muted" style="margin-top: 4px;">
            day {sprintDay(data.activeSprint.startedAt)} of {data.project.sprintLengthDays}
            {#if data.activeSprint.goal} · goal: {data.activeSprint.goal}{/if}
          </div>
        </div>
        <div style="text-align: right;">
          <div class="label">stories</div>
          <div class="metric">{data.metric.storiesDone}<span class="muted" style="font-size: 24px;">/{data.metric.storiesTotal}</span></div>
        </div>
      </div>
    {:else}
      <div class="empty">No active sprint.</div>
    {/if}
  </div>
  <div class="card">
    <h2>Debt delta this sprint</h2>
    {#if data.metric}
      <div class="metric {deltaClass(data.metric.debtDelta)}">{deltaLabel(data.metric.debtDelta)}</div>
      <div class="muted" style="margin-top: 8px;">
        <span style="color: var(--danger);">+{data.metric.debtOpened}</span> opened ·
        <span style="color: var(--ok);">−{data.metric.debtClosed}</span> closed
      </div>
    {:else}
      <div class="empty">—</div>
    {/if}
  </div>
</div>

<div class="card">
  <h2>Top open debt</h2>
  {#if data.topDebt.length === 0}
    <div class="empty">No open debt items.</div>
  {:else}
    <table>
      <thead>
        <tr>
          <th>Severity</th>
          <th>Title</th>
          <th>Location</th>
          <th>Opened</th>
        </tr>
      </thead>
      <tbody>
        {#each data.topDebt as d}
          <tr>
            <td><span class="pill sev-{d.severity}">{d.severity}</span></td>
            <td>{d.title}</td>
            <td class="mono muted">{d.location ?? ""}</td>
            <td class="muted">{formatTs(d.openedAt)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>

<div class="card">
  <h2>Recent events</h2>
  {#if data.events.length === 0}
    <div class="empty">No events yet.</div>
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
