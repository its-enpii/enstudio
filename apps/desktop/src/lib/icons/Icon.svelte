<script lang="ts">
  import { icons, type IconName } from './registry'

  let {
    name,
    size = 16,
    class: className = '',
    title = '',
    /** Keep original fills (brand logo). Default recolors black → currentColor. */
    brand = false,
  }: {
    name: IconName
    size?: number | string
    class?: string
    title?: string
    brand?: boolean
  } = $props()

  /** Recolor hard-coded black fills/strokes → currentColor; strip fixed size attrs. */
  function paint(raw: string, keepColors: boolean): string {
    let out = raw
      .replace(/\s(width|height)="[^"]*"/g, '')
      .replace(/\sxmlns="[^"]*"/g, '')
    if (!keepColors) {
      out = out
        .replace(/\sfill="(?!none)[^"]*"/gi, ' fill="currentColor"')
        .replace(/\sstroke="(?!none)[^"]*"/gi, ' stroke="currentColor"')
    }
    return out
  }

  const html = $derived.by(() => {
    const raw = icons[name]
    if (!raw) return ''
    // Brand marks (logo) always keep palette
    const keep = brand || name === 'logo'
    const body = paint(raw.trim(), keep)
    return body.replace(
      /^<svg\b([^>]*)>/,
      `<svg$1 width="100%" height="100%" aria-hidden="true" focusable="false">`,
    )
  })

  const dim = $derived(typeof size === 'number' ? `${size}px` : size)
</script>

{#if html}
  <span
    class="inline-flex shrink-0 items-center justify-center [&>svg]:block {className}"
    style="width:{dim};height:{dim}"
    role={title ? 'img' : undefined}
    aria-hidden={title ? undefined : 'true'}
    aria-label={title || undefined}
  >
    <!-- eslint-disable-next-line svelte/no-at-html-tags -->
    {@html html}
  </span>
{/if}
