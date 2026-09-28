Performance is a Design Contract term settled before implementation, not cleanup afterwards. Fix these numbers so the independent review pass can falsify them against the contract hash.

## Budget dimensions

Give every dimension a number, an owner id, and a breach action. A number without its measurement profile cannot be disputed.

- Profile: 4x CPU slowdown, 1.6 Mbps down, 150 ms RTT, cold cache, longest shipped locale.
- LCP <= 2.5 s; interaction latency <= 200 ms; layout shift <= 0.10 with none after first input.
- No main-thread task over 50 ms during load; in-app route change <= 300 ms to first update.
- Compressed first-load script <= 180 KB per route; route transfer <= 1.0 MB; images <= 400 KB per view.
- Web fonts: at most 2 families, 4 faces, 100 KB total, subset to the shipped scripts.
- Breach action is exactly one of: block the change, record an exception id, renegotiate the budget.

## Critical-path diagnosis

Trace the request to first usable pixels and name the blocking resource before writing a fix. Recurring root causes:

- a stylesheet or synchronous script in the head gating first paint;
- data requested after the client bundle boots, not during the document response;
- serial fetch chains where a child starts only once its parent settles;
- media, banners, or embeds with no reserved box, forcing relayout;
- a font swap controlled by client script, holding text invisible.

## Asset delivery

Ship the smallest asset that survives the widest box it renders into.

- Declare intrinsic width and height or aspect-ratio everywhere; unsized media is a shift defect.
- Serve width-appropriate candidates, cap the hero at 2x its container, content-hash long-lived files.
- Load the LCP image eagerly, never lazily; lazy-load everything below the fold.

## Script delivery and hydration cost

Charge every kilobyte to a named interaction; content with no interaction ships no client script.

- Split by route first, then at interaction boundaries, never below a separately reachable unit.
- Keep islands at the leaf: hydrating a shell to power one control pays for the whole subtree.
- Hold analytics, chat, consent, and flag scripts until after LCP paints.
- Mark each route static, streamed, or client-stateful, and measure hydration in main-thread ms, not bytes.

## Virtualizing long lists

Virtualize on measured evidence only, above roughly 200 rendered rows or 2,000 DOM nodes. Exercise 1 row, the threshold, and 10x the threshold.

- Disqualifying caveats: find-in-page, deep links into a row, screen-reader row counts, sticky headers, variable row height, focus after scroll, printing.
- Reserve row height so the scroll thumb stays stable; keep the announced count equal to total items, not rendered items.

## Perceived versus measured

Treat these as two obligations; satisfying one never settles the other.

- Hold a skeleton back until 200 ms of waiting, sized like the loaded content.
- Acknowledge input inside 100 ms even when the result is slower; prefer optimistic state with a named rollback to a blocking spinner.
- When only perception changed, report the measured number unchanged and label the gain advisory.

## Audit protocol

Run in order. Stop at the first step that produces a decision.

1. Restate the budget table and the measurement profile.
2. Capture one cold and one warm run per route; discard a single outlier.
3. Rank blocking resources by time held on the critical path.
4. Attribute each blocker to exactly one root cause above.
5. Estimate recoverable milliseconds per fix before editing code.
6. Apply the highest-yield fix alone, then re-measure on the same profile.
7. Decide: within budget, exception id recorded, or blocked with the missing decision named.

## Failure patterns

Reject:

- "Feels faster" with no re-measured number on the same profile.
- A composite tool score reported as a mechanical pass.
- A budget written as light, fast, or small instead of a number.
- Lazy-loading the LCP element to win a byte count.
- Virtualizing a 40-row table and losing find-in-page.
- Cutting accessibility work and calling it a performance decision.
