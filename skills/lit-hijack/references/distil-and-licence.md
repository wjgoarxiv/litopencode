# Distil and licence

Distilling turns sources into mechanism cards: what a technique does, why it works, and how sure anyone can be. The licence gate then decides, per source, what the port may take. Both steps separate the transferable method from the author's expression of it.

## Mechanism, evidence, opinion

A source usually mixes three things. Keep them apart on every card.

| Part | What it looks like | Where it goes |
| --- | --- | --- |
| Mechanism | A step, rule, structure, check or default that produces an effect | `what` and `why` |
| Evidence | A measurement, a before/after, a reproducible example, a failure story with a cause | `evidence` and `evidence_note` |
| Opinion | Taste, prediction, preference, a confident claim that lacks support | a card marked `opinion`, or dropped |

Evidence classes:

- `evidenced`: someone measured it, showed comparable outputs, or you reproduced the mechanism from the description.
- `anecdotal`: a practitioner reports it worked for them, with enough detail to understand why, and with a measurement missing.
- `opinion`: a stance or a style choice. Still worth porting when it fits the target, and the report says it was taken on taste.

A post that is mostly opinion can still carry one solid mechanism. A post full of numbers can carry nothing you can use. Judge each card on its own.

## Writing a card

```json
{
  "id": "M1",
  "title": "Production brief before any render",
  "sources": ["S1", "S3"],
  "locator": "S1 section 1; S3 pages 4-6",
  "what": "A short production note fixes the takeaway, the allowed references, the real assets and the rejection condition before the first frame is drawn.",
  "why": "Any decision left open gets filled by the model's default, and those defaults are why unrelated outputs look alike.",
  "evidence": "anecdotal",
  "evidence_note": "Two practitioners report it; neither measured it."
}
```

Write `what` as behaviour someone could observe in the target after the port, and `why` as the failure the mechanism prevents. If the only phrasing you can find is the author's sentence, you hold the sentence and the mechanism is still ahead of you; reread the source, close it, and explain it as you would to a colleague.

Merge cards that describe one technique from several sources, and name every source on the merged card. Keep a card that only one source has. Split a card that bundles two techniques with different evidence.

## What is worth porting

Four questions decide whether a card earns a place in the target:

1. **Is it new?** Run the target's typical task once unaided and see whether the base model already does this. A mechanism the model follows by itself is a zero gain.
2. **Is it a mechanism or a mood?** "Make it feel premium" is a mood. "Limit the palette to three tokens declared before the build" is a mechanism.
3. **Can the target hold it?** Some techniques need surfaces the target lacks (a renderer, a hook event, a runtime). Note the missing surface and skip the imitation.
4. **Can its effect be seen?** If every output would stay the same after the port, the parity step has nothing to prove. Find the marker before you take it.

## Good theft, as a checklist

The old distinction between good and bad theft maps onto this skill:

| Good | Bad | In a hijack run |
| --- | --- | --- |
| Honour the source | Degrade it | Credit in the report; represent the source's claims fairly |
| Study it | Skim it | Read every captured source in full before writing cards |
| Steal from many | Steal from one | Merge techniques across sources; compare them |
| Credit | Plagiarise | Provenance rows, and a shipped credit line where the licence asks |
| Transform | Imitate | Re-express in the target's idiom, structure and examples |
| Remix | Rip off | Combine with what the target already does well |

## The licence table

Ideas, procedures, methods and facts sit outside copyright in most legal systems, and the expression of them is protected. That split is why every decision below permits mechanisms and every one of them withholds wording. `hijack.mjs licence` applies this table from the captured licence evidence:

| Licence evidence | Class | Decision | Reason |
| --- | --- | --- | --- |
| MIT, ISC, BSD-2/3-Clause, Apache-2.0, Zlib, BSL-1.0 | permissive | `ideas-credit` | Reuse is allowed; the port takes mechanisms only and ships a credit line |
| 0BSD, Unlicense, CC0-1.0 | permissive | `ideas-credit` | Conditions are absent; credit is a courtesy the target still pays |
| CC BY | attribution | `ideas-credit` | The licence asks for credit when material is shared; credit the ideas too |
| GPL, LGPL, AGPL, MPL, EPL, CC BY-SA | copyleft | `ideas-only` | Copying would pull the target under the source's terms; keep the implementer away from the source |
| CC BY-NC, CC BY-ND | restricted | `ideas-only` | Commercial use or shared adaptations are barred; mechanisms only |
| Empty result (`NOASSERTION`) | unlicensed | `ideas-only` | Default copyright applies, all rights reserved; posts, blogs, PDFs and most gists land here |
| Anything else | unrecognised | `ideas-only` | Treated as all rights reserved until a person says otherwise |
| Text that states reuse terms | restricted-terms | `needs-review` | "do not copy", "no part of this", "source-available", "proprietary", "confidential" |

The reuse-term scan reads rights-related lines (copyright, licence, terms, permission, rights) and skips running prose, so an article that warns readers "DO NOT COPY this config blindly" stays `ideas-only`.

`needs-review` blocks the licence phase until a person decides:

```text
$H licence <run> --set S4=ideas-only --reason "copyright page restricts reproduction; we take the method only"
$H licence <run> --set S5=no-go --reason "material was shared privately"
```

A user decision is kept on later `licence` runs. Record the reason in plain words.

`no-go` applies whatever the licence says when the capture crossed a login or paywall, when the material is leaked, private or confidential, or when terms forbid the use you intend. A mechanism that rests only on no-go sources stays out; one that also has an allowed source may be taken on that source alone, and its card says so.

## Credit lines

For `ideas-credit` sources the target ships a short notice, in the style the target already uses (an `ATTRIBUTION.md` beside a skill is common). Each entry names the work, the author, the URL, the licence, and one sentence on what idea was adapted and that the port reused text or code from the source in zero places. For `ideas-only` sources the report carries the credit, and the target carries it too when the user wants it; ask once.

Credit is ethics and courtesy. The legal position of a copy stays as it was, which is why the build avoids copying in the first place.

## Jurisdiction and limits

Quotation rules, moral rights and the line between idea and expression differ between countries, and close paraphrase or copied structure can still infringe where the words differ. This procedure lowers risk and certifies nothing. When a source matters commercially and its terms are murky, tell the user once and let them decide. Patents and trademarks sit outside this gate: re-expressing a method leaves a patent on it standing, and a source's product names stay the source's.
