# Explainer Artifact Template

This reference documents a focused section order and diagram markup for comprehend explainers.

## Section Contract

Choose the sections the explanation needs and keep this order. Omit the hands-on section when the change has no behavior to explore.

### 한눈에

One-paragraph summary of what changed and why it matters. Assume the reader knows the objective. Link to the most important theme below.

### 이미 알고 있던 것

State the reader's starting point: the objective, the brief, the ledger's first timestamp, what was already working. This section anchors the delta so the reader never feels lost.

### 직관

Build intuition with toy data that reappears across the whole document. Use 2-3 diagram families:

- **Pipeline** (`.pipe`): show data flowing through named stages.
- **Before/After** (`.ba`): side-by-side comparison of old and new behavior.
- **State/Timeline** (table): show progression over time or through states.
- **Simplified UI**: a static mockup showing the user-facing change.

Diagrams are HTML/CSS. Never ASCII art.

### 바뀐 것

Walk through the actual changes grouped into named themes. Each theme explains one coherent idea. Order themes so each is comprehensible from what came before.

Code excerpts use `<pre data-src="path:startLine-endLine">` with `.add` and `.del` span classes for changed lines. Quote only lines that exist in the cited file.

### 직접 만져보기

A micro-world: a small interactive widget. Patterns:

- **Faithful miniature**: port logic to JS with editable input.
- **Slider**: range input for threshold/sensitivity.
- **Step-through**: next/reset buttons for pipeline visualization.
- **Old/new toggle**: radio buttons comparing before/after.

Always label as a simplified model. Use the same toy data as the 직관 section. Omit for purely structural changes.

### 퀴즈

5 questions (3 for a small change). Each question has `data-answer` on the `.quiz-q` container. Each option (`.opt[data-i]`) has a matching feedback block (`.fb[data-i]`). Rules:

- Every option gets feedback explaining WHY it is right or wrong.
- No positional tell: vary the correct slot across questions (no 3-in-a-row same position).
- No length tell: keep options at roughly even lengths.
- The quiz slows the reader down; it is not a grade.

### 다음

Concrete next actions ordered by priority. Each names an OpenCode command or surface when applicable.

## Diagram Markup Reference

### Pipeline

```html
<div class="pipe">
  <div class="box">Stage A</div>
  <div class="box">Stage B</div>
  <div class="box">Stage C</div>
</div>
```

### Before/After

```html
<div class="ba">
  <div><h4>Before</h4><pre>old behavior</pre></div>
  <div><h4>After</h4><pre>new behavior</pre></div>
</div>
```

### Callout Classes

- `.note.ok` -- success, verified fact.
- `.note.warn` -- caution, partial evidence.
- `.note.bad` -- failure, missing evidence.
- `.skippable` -- reader may skip if short on time.

### Code Blocks

```html
<pre data-src="src/activation-routing.ts:33-56">
<span class="del">- old line</span>
<span class="add">+ new line</span>
unchanged line
</pre>
```

## Markdown Fallback (--md)

When `--md` is requested: quizzes become `<details>` blocks, micro-worlds become worked examples with explicit before/after values, and diagrams become indented prose descriptions.
