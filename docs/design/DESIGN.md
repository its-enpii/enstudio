---
name: Enpiistudio Design System
colors:
  surface: '#151313'
  surface-dim: '#151313'
  surface-bright: '#3c3838'
  surface-container-lowest: '#100e0e'
  surface-container-low: '#1e1b1b'
  surface-container: '#221f1f'
  surface-container-high: '#2c2929'
  surface-container-highest: '#373434'
  on-surface: '#e8e1e0'
  on-surface-variant: '#c8c4d3'
  inverse-surface: '#e8e1e0'
  inverse-on-surface: '#33302f'
  outline: '#928f9d'
  outline-variant: '#474551'
  surface-tint: '#c6c0ff'
  primary: '#c6c0ff'
  on-primary: '#2c2179'
  primary-container: '#3d348b'
  on-primary-container: '#aba3ff'
  inverse-primary: '#5b53aa'
  secondary: '#f6be3d'
  on-secondary: '#402d00'
  secondary-container: '#c08e00'
  on-secondary-container: '#3e2b00'
  tertiary: '#c7c1f2'
  on-tertiary: '#2f2b53'
  tertiary-container: '#403c65'
  on-tertiary-container: '#ada8d8'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#e4dfff'
  primary-fixed-dim: '#c6c0ff'
  on-primary-fixed: '#150066'
  on-primary-fixed-variant: '#433a91'
  secondary-fixed: '#ffdea2'
  secondary-fixed-dim: '#f6be3d'
  on-secondary-fixed: '#261900'
  on-secondary-fixed-variant: '#5c4200'
  tertiary-fixed: '#e4dfff'
  tertiary-fixed-dim: '#c7c1f2'
  on-tertiary-fixed: '#1a163d'
  on-tertiary-fixed-variant: '#46426b'
  background: '#151313'
  on-background: '#e8e1e0'
  surface-variant: '#373434'
typography:
  headline-lg:
    fontFamily: Hanken Grotesk
    fontSize: 32px
    fontWeight: '600'
    lineHeight: '1.2'
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Hanken Grotesk
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.3'
  body-lg:
    fontFamily: Hanken Grotesk
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.5'
  body-md:
    fontFamily: Hanken Grotesk
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.5'
  label-sm:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '500'
    lineHeight: '1.2'
  code-md:
    fontFamily: JetBrains Mono
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.6'
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 8px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  gutter: 16px
  sidebar_width: 260px
---

## Brand & Style

This design system is built for a calm, professional, and high-performance AI coding workspace. The aesthetic merges **Modern Corporate** reliability with a **Subtle Glassmorphism** overlay to manage depth in a dark-first environment. 

The system prioritizes "Reviewability" and "Local-first" confidence. It avoids the clutter of traditional IDEs by using generous whitespace within a dense grid, ensuring the interface feels tool-like but approachable. The emotional goal is "Focused Flow"—where the AI assists without distracting, and the UI provides a stable, high-contrast canvas for logic and creativity.

## Colors

The palette is anchored in a "Near-Black" (#040303) to minimize eye strain during long sessions. 
- **Primary Deep Purple**: Used for active states, primary actions, and focus rings. It represents the "intelligence" layer of the application.
- **Accent Gold**: Reserved exclusively for "Running" or "Processing" states, badges, and subtle notifications. It provides a warm, high-visibility contrast against the cool purple and dark surfaces.
- **Surface Elevation**: Sidebars and Inspector panels use a slightly lifted #0E0D12, creating a subtle hierarchical distinction from the main editor workspace.
- **Borders**: All structural boundaries use a 25% opacity Deep Purple, creating a cohesive, "glow" effect that defines the grid without visual noise.

## Typography

The typography system uses a clean, contemporary Grotesque for the UI and a technical Monospace for data and code. 
- **UI & Navigation**: Hanken Grotesk provides a sharp, professional character that remains legible at small sizes.
- **Technical Contexts**: JetBrains Mono is used for code blocks, file paths, terminal output, and status labels. This creates an immediate cognitive distinction between "Application UI" and "Project Data."
- **Scale**: Headlines are tight and impactful, while body text uses a slightly relaxed line-height (1.5) to ensure high readability in documentation and AI chat responses.

## Layout & Spacing

This design system employs a **strict 8px grid**. All margins, paddings, and component heights must be multiples of 8px (or 4px for fine-grained internal alignments).

- **Layout Model**: A 3-pane layout is standard (Sidebar / Main Editor / Inspector). 
- **Density**: The interface is "Dense but not Cramped." This is achieved by using generous external margins (24px+) around the main container, while keeping internal component padding tight (8px or 12px).
- **Responsiveness**: On smaller screens, the Inspector and Sidebar collapse into drawers. The Editor maintains a minimum width of 600px before introducing horizontal scrolling for code preservation.

## Elevation & Depth

Depth is conveyed through **Tonal Layers** and **Subtle Glows** rather than traditional drop shadows.

- **Level 0 (Base)**: Near-Black (#040303) background.
- **Level 1 (Panels)**: Sidebar and Inspector panels use #0E0D12 with a 1px border of 25% Purple.
- **Level 2 (Floating/Modals)**: Floating toolbars and modals use a slightly more opaque purple border (40%) and a dark backdrop blur (12px) to separate from the code layer.
- **Interactive Depth**: When an element is hovered, the background should not necessarily lighten; instead, the border opacity should increase to 50% to "illuminate" the interactive area.

## Shapes

The shape language is **Generously Rounded**, contrasting with the rigid, square nature of most IDEs. This choice softens the "technical" feel and makes the AI interaction feel more organic.

- **Standard Elements**: 0.5rem (8px) for buttons, inputs, and small cards.
- **Large Containers**: 1rem (16px) for main workspace panels and floating toolbars.
- **Pills**: Badges and running state indicators use fully rounded (pill) ends to differentiate them from interactive buttons.

## Components

- **Buttons**: Primary buttons are solid Deep Purple with Off-White text. Secondary buttons use a Purple border (30%) with no fill. Ghost buttons are used for sidebar actions.
- **Floating Toolbar**: A signature component positioned at the bottom-center of the editor. It features a high backdrop-blur, 16px corner radius, and houses the primary AI "Prompt" input.
- **Badges**: Use Gold for "Running," "Active AI," or "Pending Review." Use Purple for "Saved," "Local," or "Ready."
- **Input Fields**: Soft-edged (8px) with a subtle purple-lifted background. On focus, the border transitions to 100% opacity Deep Purple.
- **Cards (Code Review)**: Feature a slightly thicker border on the left side (4px) in either Purple or Gold to indicate the status of the AI suggestion.
- **Scrollbars**: Minimalist, "ghost" style. 4px wide, dark purple with 20% opacity, increasing to 50% on hover.