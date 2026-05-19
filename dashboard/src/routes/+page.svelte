<script lang="ts">
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();
</script>

<div class="card">
  <h2>Projects</h2>
  {#if data.projects.length === 0}
    <div class="empty">
      No projects yet. Open a terminal in any git repo and run an MCP tool (or <code>helm banner</code>) — the project will appear here.
    </div>
  {:else}
    <table>
      <thead>
        <tr>
          <th>Project</th>
          <th>Slug</th>
          <th>Sprint length</th>
        </tr>
      </thead>
      <tbody>
        {#each data.projects as p}
          <tr>
            <td><a href="/p/{p.slug}/"><strong>{p.name}</strong></a></td>
            <td class="mono muted">{p.slug}</td>
            <td class="muted">{p.sprintLengthDays}d</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>
