<script lang="ts">
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  function formatTs(ts: string): string {
    return new Date(ts).toLocaleDateString();
  }
</script>

<div class="card">
  <h2>Architectural decisions</h2>
  {#if data.decisions.length === 0}
    <div class="empty">No decisions recorded. Use <code>record_decision</code> to capture one.</div>
  {:else}
    <table>
      <thead>
        <tr>
          <th style="width: 110px;">Date</th>
          <th>Title</th>
          <th>Decision</th>
          <th style="width: 110px;">Status</th>
        </tr>
      </thead>
      <tbody>
        {#each data.decisions as d}
          <tr>
            <td class="muted">{formatTs(d.decidedAt)}</td>
            <td>
              <strong>{d.title}</strong>
              {#if d.context}
                <div class="muted" style="font-size: 13px; margin-top: 4px;">{d.context}</div>
              {/if}
            </td>
            <td>{d.decision}</td>
            <td><span class="pill status-{d.status}">{d.status}</span></td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>
