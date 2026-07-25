<script lang="ts">
  let { title, blurb }: { title: string; blurb: string } = $props()
</script>

<div class="stage">
  <div class="placeholder-stage">
    <div style="text-align:center">
      <div class="ph-title">{title}</div>
      <div class="muted">{blurb}</div>
    </div>
  </div>
</div>
