# Slop register for rendered interfaces

Run the deterministic probe before making a holistic judgment. A visible signature is evidence of that signature, not proof that a whole page is generic. DET rows may become a finding; DET-assist rows still need a reviewer. JUDG rows are prompts for a reasoned decision and enter the review as Inferred. `scripts/probe-thresholds.json` owns machine thresholds and severities. If a rule is absent from the probe's findings and cannot be checked, name it in `not_verified`.

## Layout and composition

| ID | Probe signal and review question | Cheaper fix |
| --- | --- | --- |
| SLOP-001 | Repeated split-hero geometry across pages; is the second use genuinely needed? | Recompose the repeated section. |
| SLOP-002 | Four or more sibling tiles with the same image, title and copy geometry. | Merge or vary content structure. |
| SLOP-003 | Card shells nested inside card shells or empty bento cells. | Delete the extra shell or cell. |
| SLOP-004 | A split heading padded with a generic filler paragraph. | Keep the useful sentence, remove filler. |
| SLOP-005 | Several sections repeat one layout family without content reason. | Reorder around the task hierarchy. |
| SLOP-006 | One spacing bucket dominates a real multi-region page; exclude a page with legitimate CF-302 grouping. | Add a meaningful group break. |
| SLOP-007 | A large empty area has no hierarchy or reading role. | Tighten the composition. |

## Decorative reflexes

| ID | Probe signal and review question | Cheaper fix |
| --- | --- | --- |
| SLOP-008 | Heading text or gradient stops in the 260–310° hue band with at least 50/255 channel spread, without a declared brand reason. | Use the chosen palette. |
| SLOP-009 | A gradient is clipped into text. | Use a solid readable text colour. |
| SLOP-010 | Recurring chromatic large-blur halos are MEDIUM; a single glow stays under CF-404. | Remove the glow. |
| SLOP-011 | A faint floating sphere or blob has no content referent. | Remove it or give it a real purpose. |
| SLOP-012 | Repeating dot/grid texture accompanies another decorative reflex without data behind it. | Remove the texture. |
| SLOP-013 | Noise or ornament makes the information hierarchy harder to read. | Strip the decoration first. |
| SLOP-014 | Glass blur appears because the component library offers it, with no reason. | Use an opaque surface. |
| SLOP-015 | Repeated coloured edge stripes or pseudo-borders on rounded cards. | Use the card's actual border or remove the stripe. |

## Type and colour

| ID | Probe signal and review question | Cheaper fix |
| --- | --- | --- |
| SLOP-016 | A common default sans is used with no deliberate type choice; Geist variants are exempt. | Choose the page's intentional type stack. |
| SLOP-017 | A decorative serif appears without a stated content or brand role. | Return to the established type system. |
| SLOP-018 | Huge heading is paired with a weak, tiny explanatory line. | Rebalance type sizes and message order. |
| SLOP-019 | Too many unrelated type roles appear in one view. | Reuse a named role. |
| SLOP-020 | All-caps labels spread beyond a deliberate small role. | Use sentence case. |
| SLOP-021 | Gray text loses contrast on a coloured surface; CF-201 owns the ratio. | Correct the text/background pair. |
| SLOP-022 | Several accent hue clusters appear; CF-205 owns the count. | Reserve one accent for interaction. |
| SLOP-023 | Pure black or white base fills flatten a page meant to have a tonal surface. | Use the chosen near-neutral surface. |

## Motion and micro-labels

| ID | Probe signal and review question | Cheaper fix |
| --- | --- | --- |
| SLOP-024 | Routine feedback bounces; CF-505 owns the curve check. | Use the calm feedback token. |
| SLOP-025 | Entrance scales up from nearly nothing; CF-503 owns the floor. | Start near full size or fade. |
| SLOP-026 | Continuous animation changes layout geometry; CF-508 owns the property check. | Animate transform/opacity. |
| SLOP-027 | Infinite pulse/blink runs without a bound status change. | Stop it or bind it to real state. |
| SLOP-028 | Every repeated row/control animates on routine use; CF-506 owns the duration. | Remove surplus motion. |
| SLOP-029 | An eyebrow/kicker appears above section after section. | Keep only a label with real navigational value. |
| SLOP-030 | Decorative section numbers imply a sequence that does not exist. | Remove the numbers. |
| SLOP-031 | A version/status stamp dresses a public page as an unreleased prototype. | Keep true release information only. |
| SLOP-032 | A coloured dot has no state source or label. | Bind it to state or delete it. |
| SLOP-033 | Repeated middle-dot locale/time strips add no information. | Write one clear context line. |
| SLOP-034 | A decorative strip of buzzwords closes the hero. | Remove it and let the main action lead. |
| SLOP-035 | A scroll cue decorates the first viewport despite ordinary scroll affordance. | Delete the cue. |

## Copy, assets and controls

| ID | Probe signal and review question | Cheaper fix |
| --- | --- | --- |
| SLOP-036 | Generic marketing phrases replace a concrete claim. | Name a real capability or remove the claim. |
| SLOP-037 | A known filler wordmark stands in for the requested product. | Use a brief-grounded name. |
| SLOP-038 | A stock placeholder person name appears in attribution. | Use a credible, labelled example. |
| SLOP-039 | The same short negation-then-restatement cadence repeats three times. | Vary sentence structure. |
| SLOP-040 | A flourish dash appears in shipped copy. | Rewrite with normal punctuation. |
| SLOP-041 | A suspiciously neat or overprecise number lacks a source or mock label. | Cite it, mark it as a sample, or remove it. |
| SLOP-042 | Several CTA labels point to the same intent. | Reuse one label. |
| SLOP-043 | Nested divs imitate a product screenshot but show no real media/component. | Use a real image or live component. |
| SLOP-044 | Fake version/sync text decorates a preview or marketing footer. | Remove the invented metadata. |
| SLOP-045 | Four same-shape stat siblings, or three beside a marketing CTA, are a DET-assist candidate; a reviewer confirms whether they are ornamental before MEDIUM. | Remove or source the numbers. |
| SLOP-046 | A gauge, sparkline or progress figure is a constant with no data binding. | Remove or bind real data. |
| SLOP-047 | A tiny, repeating logo ticker has too few legible distinct marks. | Enlarge or use a static row. |
| SLOP-048 | Carousel dots autoplay but cannot be controlled accessibly. | Remove dots or wire keyboard controls. |
| SLOP-049 | A generic silhouette avatar stands in for a person. | Use a purposeful illustration/photo. |
| SLOP-050 | Every trust-wall logo gets a redundant category caption. | Drop the caption. |

## Illustration and overall read

| ID | Probe signal and review question | Cheaper fix |
| --- | --- | --- |
| SLOP-051 | An inline SVG at least 200×200px with at least eight raw shapes, three fills, no pattern and at most two text nodes is a reviewer candidate. | Simplify or use a real asset. |
| SLOP-052 | A polygon with at least ten vertices and at least half of coordinates off the 25% grid, or a `path()` with at least three curves, is a mask candidate. | Crop the image deliberately. |
| SLOP-053 | Emoji appears as a nav/control/status icon without an explicit exception. | Use the page's icon system. |
| SLOP-054 | Hover transform targets an image itself rather than its frame. | Move motion to the wrapper. |
| SLOP-055 | At least two small deterministic tells recur on the same component. | Break up the cluster. |
| SLOP-056 | The whole page could carry any competitor's name without changing its message. | Name the contributing rows above before fixing. |

## Functional extension

| ID | Probe signal and review question | Cheaper fix |
| --- | --- | --- |
| SLOP-057 | Image source is empty/invalid or fails to decode. | Correct or remove the image. |
| SLOP-058 | Link points to `#` or a script URL; the attribute proves only that fact, not absence of a handler. | Give it a destination or make it a button. |
| SLOP-059 | An implicit-submit button whose form owner has at least two submit-capable buttons is HIGH; a lone implicit submit is allowed. | Set the intended type. |
| SLOP-060 | Visible lorem or bracketed placeholder instruction remains. | Replace it with task copy. |
| SLOP-061 | Marquee or unpausable text ticker scrolls forever. | Use a static row or add pause. |
| SLOP-062 | Modal interrupts a routine action with no blocking need. | Use an inline panel or toast. |
| SLOP-063 | Monospace clothes ordinary prose as technical data. | Use normal body type. |

Run the reviewer on real screenshots at the responsive matrix after the DET pass. For a change review, inspect removed focus styles, labels, semantic controls, reduced-motion guards, visible error wording and token references as well as added code. Use the same `Severity | Rule | Where | Measured | Fix` table; put every inaccessible surface in `Not verified`. A HIGH can be closed by a measured fix or carried as a stated limitation with its reason, never silently ignored.
