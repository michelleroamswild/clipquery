# Media Indexer Design System & Style Guide
`Version: 1.0.0` | `Status: Production-Ready` | `Archetype: Utilitarian / Archival`

This document defines the architectural layout, core design principles, and visual style guidelines for the Media Index application. It rejects standard generative AI tropes (neon gradients, soft cards, floating sparkle icons) in favor of a dense, deterministic, and highly structural interface optimized for archival browsing and data integrity.

---

## 1. Product Vision & Intent

The Media Indexer is a high-density, lightning-fast workbench designed to archive, analyze, and catalog large volumes of personal photos and videos. It strips away the social-media "feed" mentality and replaces it with a powerful digital vault.

While the backend leverages advanced machine learning for automated metadata tagging, visual scene description, OCR, and geospatial clustering, the interface treats AI strictly as an **invisible utility engine**. The AI generates structured data; it does not dictate the aesthetic.

---

## 2. Core Design Principles

### 2.1 Utility Over Decoration
Form follows function entirely. If an element does not serve a structural, navigational, or information-dense purpose, it is eliminated. Decorative whitespace is minimized to keep a maximum amount of media and text visible on a single screen.

### 2.2 Deterministic Provenance
The UI must explicitly and visibly distinguish between **human-authored data**, **hardware-embedded data**, and **AI-generated inferences**. The system never displays data magically; it declares exactly where it came from.

### 2.3 Structural Rigidity
Layouts are anchored to strict, unyielding grids. Elements feature razor-thin borders, minimal rounding, and sharp alignments reminiscent of technical drafting tools, professional camera firmware, or GIS software panels.

### 2.4 Keyboard-First Efficiency
The application should operate with the speed of an IDE or terminal interface. Every primary browsing, filtering, and metadata editing action must be mapable to discrete keyboard shortcuts.

---

## 3. Visual & Style Guide

### 3.1 Color Palette
The color language borrows from archival storage rooms, matte-black hardware instruments, and industrial displays. Colors are desaturated, low-contrast for reduced eye strain during long sessions, and hyper-targeted when used for status signals.

    +-----------------------------------------------------------------------+
    |  --bg-app          |  #121314  |  Main interface base slate           |
    |  --bg-surface      |  #1C1D1F  |  Sidebar, panels, inspectors         |
    |  --border-subtle   |  #2D2F33  |  Gridlines, dividers, matrix lines   |
    |  --text-primary    |  #E4E5E7  |  Primary crisp data and headers      |
    |  --text-muted      |  #8C8E93  |  Labels, secondary metadata, logs    |
    |  --accent-utility  |  #D4AF37  |  Muted Ochre (AI/ML Data Provenance) |
    |  --status-success  |  #4ADE80  |  Mint Green (Pipeline Complete)      |
    +-----------------------------------------------------------------------+

### 3.2 Typography
To break completely from the ubiquitous Inter/SF Pro look, this system implements a razor-sharp, technical sans-serif for primary navigation, paired with a high-readability monospace font for all system metrics, timecodes, data values, and metadata outputs.

* **Primary System Sans:** *Instrument Sans*, *Geist Sans*, or *Franklin Gothic* (Clean, flat tracking, neutral).
* **Data & Metadata Mono:** *JetBrains Mono* or *Geist Mono* (Strict vertical alignment, excellent distinction between similar characters like `0` and `O`).

    /* Typography Scale Specification */
    h1 { font-size: 18pt; font-weight: 700; tracking: -0.02em; color: var(--text-primary); }
    h2 { font-size: 13pt; font-weight: 600; tracking: -0.01em; color: var(--text-primary); }
    body { font-size: 11pt; font-weight: 400; font-family: sans-serif; color: var(--text-primary); }
    .data-mono { font-size: 10pt; font-family: monospace; color: var(--text-muted); }

### 3.3 Component Architecture Constraints
* **Corners:** Radius is pinned to `0px` for all layout structures, panels, and sidebars. Small components like tags, buttons, and media thumbnails allow a maximum radius of `2px` to prevent clipping visual boundaries while maintaining structural rigidity.
* **Borders:** Strict `1px` solid layouts using `--border-subtle`. No box-shadows, soft blurs, ambient glows, or glassmorphism (`backdrop-filter`) are permitted.
* **Transitions:** Interaction states rely on instantaneous opacity shifts or hard color inversions (e.g., swapping background and text color). Smooth animations, spring curves, or scale-ups are banned.

---

## 4. Interface Layout & Workbench Structure

The system runs a fixed-height, zero-overflow 3-column workbench interface optimized for desktop environments and wide-aspect displays.

    +--------------------------------------------------------------------------------------+
    | LOGO / NAV     | SEARCH & FILTERS (Multi-parameter text & token input field)         |
    +----------------+---------------------------------------------------------------------+
    | [ ] Library    | [X] [X] [X] [X] [X] [X] [X] [X]  | METADATA INSPECTOR Panel          |
    | [ ] Timeline   | [X] [X] [X] [X] [X] [X] [X] [X]  | ------------------------          |
    | [ ] Geospatial | [X] [X] [X] [X] [X] [X] [X] [X]  | FILE: DSC_4912.NEF                |
    |                | [X] [X] [X] [X] [X] [X] [X] [X]  | SIZE: 42.4 MB                     |
    | COLLECTIONS    | [X] [X] [X] [X] [X] [X] [X] [X]  |                                   |
    | - 2026_Baja    | [X] [X] [X] [X] [X] [X] [X] [X]  | DESC: [ML] Deep alpenglow over    |
    | - Sierra_Off   | [X] [X] [X] [X] [X] [X] [X] [X]  |            granite ridgelines.    |
    | - White_Mtns   | [X] [X] [X] [X] [X] [X] [X] [X]  | TAGS: [ML] sierra, peaks, granite |
    |                | [X] [X] [X] [X] [X] [X] [X] [X]  | LAT:  [HW] 36.5785° N             |
    |                | [X] [X] [X] [X] [X] [X] [X] [X]  | LON:  [HW] 118.2920° W            |
    +----------------+---------------------------------------------------------------------+
    | STATUS LOGS: Pipeline idle. Index synchronized (42,819 items).                       |
    +--------------------------------------------------------------------------------------+

### 4.1 Layout Panes
1.  **Left Column (Navigation Tree):** Fixed width (`240px`). Houses structured directory roots, smart system folders, temporal timeline indexes, and active pipelines.
2.  **Center Column (Media Matrix Grid):** Fluid width. Renders an ultra-dense thumbnail array. Media files are bounded inside strict square containers to enforce row/column alignment, or stacked in a zero-gap vertical grid.
3.  **Right Column (Data Inspector):** Fixed width (`380px`). The focal point of the utility. Dissects the currently focused asset, surfacing a split breakdown of structural data parameters.

---

## 5. Interaction Patterns & Anti-Slop Guardrails

### 5.1 No "Magic" AI States
Standard AI tools obscure background compute using floating sparkle vectors (`✨`), shifting iridescent color rings, and staggered text typing effects. This system strictly prohibits those patterns.
* **Processing States:** When the machine learning background worker is actively describing a newly imported scene or running OCR on a text asset, the panel renders a rigid terminal-style ASCII loader string or block cursor: `[PROCESSING: █░░░░░░░░░ 10%]`.
* **Instantaneous Commits:** Once an inference is returned, the layout updates instantly. No fading text, no typing effect, no artificial delays.

### 5.2 Explicit Provenance Tags
To establish absolute transparency and trust over the database index, every single structural entry within the Data Inspector must declare its exact source origin via a desaturated status bracket:

* `[HW]` **Hardware / Embedded:** Extracted cleanly from the file's binary container (EXIF, XMP, IPTC headers, GPS chips, camera sensor profiles).
* `[ML]` **Machine Learning / Inferred:** Generated by localized or cloud-orchestrated vision, language, or embedding models. These data types use the subtle `--accent-utility` ochre tone to call attention to machine inferences.
* `[USER]` **Verified / Manual:** Modified, added, or explicitly confirmed by the human operator. 

*Interaction Guardrail:* Clicking any inline `[ML]` text string opens a text cursor. Modifying the text or hitting `Ctrl + Enter` immediately switches the provenance state token to `[USER]`, locking the field against any future algorithmic overwriting.

### 5.3 Keyboard Routing Architecture
Navigating and optimizing thousands of media entities requires avoiding pointer devices for repeatable sequences.

* `J` / `K` : Focus next/previous item down or up within the current Media Matrix grid row.
* `H` / `L` : Focus left/right adjacent item within the Matrix grid.
* `/` : Immediately target the main search field, clearing active selection states.
* `E` : Jump keyboard focus instantly to the first editable `[ML]` value in the Data Inspector pane.
* `V` : Toggle preview full-screen layout.
* `Space` : Flag item for batch extraction or custom action pipelines.