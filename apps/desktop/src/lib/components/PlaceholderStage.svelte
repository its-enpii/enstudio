<script lang="ts">
  let { title, blurb }: { title: string; blurb: string } = $props()
</script>

<div class="flex h-full min-h-0 w-full items-center justify-center p-8">
  <div class="text-center">
    <div class="mb-2 text-sm font-medium text-studio-text">{title}</div>
    <div class="text-xs text-studio-text-dim">{blurb}</div>
  </div>
</div>
