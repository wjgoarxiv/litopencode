import type { LitOpenCodeFeature } from "./features.ts";
import type { LitOpenCodeRuntimeSkill } from "./skills.ts";

// frontend-ui-ux and visual-qa moved to the `design` family of wjgoarxiv-skills. Both ids stay registered so
// the interface chat route, the post-edit hint and the native skill picker still land on a same-name pointer.
export const frontendUiUxFeature = {
  id: "frontend-ui-ux",
  title: "Frontend UI/UX",
  summary:
    "Pointer for the interface skill that moved to wjgoarxiv-skills (design family): routes still reach it, and it gives the OpenCode install line.",
  bindings: [
    {
      kind: "config",
      id: "skills/frontend-ui-ux/SKILL.md",
      surface: "OpenCode native skill frontend-ui-ux",
      description: "Same-name pointer: says the skill moved, names plugins/design/skills/frontend-ui-ux/ in wjgoarxiv-skills and gives the one OpenCode install line."
    },
    {
      kind: "hook",
      id: "chat.message",
      surface: "OpenCode chat.message design intent",
      description: "A making verb aimed at a page, screen, layout or component still selects this pointer before any file is edited."
    },
    {
      kind: "cli",
      id: "litopencode install",
      surface: "LitOpenCode native skill installer",
      description: "Installs the pointer as SKILL.md alone and leaves a user-copied frontend-ui-ux folder in place."
    }
  ],
  verification: ["node --test test/moved-skill-stubs.test.mjs", "node --test test/uiux-mode-routing.test.mjs"]
} satisfies LitOpenCodeFeature;

export const visualQaFeature = {
  id: "visual-qa",
  title: "Visual QA",
  summary:
    "Pointer for the rendered-surface check that moved to wjgoarxiv-skills (design family): routes still reach it, and it gives the OpenCode install line.",
  bindings: [
    {
      kind: "config",
      id: "skills/visual-qa/SKILL.md",
      surface: "OpenCode native skill visual-qa",
      description: "Same-name pointer: says the skill moved, names plugins/design/skills/visual-qa/ in wjgoarxiv-skills and gives the one OpenCode install line."
    },
    {
      kind: "hook",
      id: "chat.message",
      surface: "OpenCode chat.message visual-qa",
      description: "A bounded visual-qa or visual qa mention still selects this pointer."
    },
    {
      kind: "cli",
      id: "litopencode install",
      surface: "LitOpenCode native skill installer",
      description: "Installs the pointer as SKILL.md alone and leaves a user-copied visual-qa folder in place."
    }
  ],
  verification: ["node --test test/moved-skill-stubs.test.mjs"]
} satisfies LitOpenCodeFeature;

export const frontendUiUxRuntimeSkill = {
  id: "frontend-ui-ux",
  title: "Frontend UI/UX",
  summary:
    "Pointer: frontend-ui-ux moved to wjgoarxiv-skills (design family); the same-name stub says where it went and gives the OpenCode install line.",
  featureIds: ["frontend-ui-ux", "doctor-install"],
  discovery:
    "Describe interface work in chat (a making verb aimed at a UI, screen, layout, component, or stylesheet), select the frontend-ui-ux OpenCode native skill, or follow the post-edit hint when an interface file changes; each reaches the pointer.",
  safety: [
    "Give the install line and build nothing from the pointer; never produce a hand-made stand-in for the moved skill's output.",
    "Inside lit-loop or an approved plan, name the missing skill once and report the interface slice as unverified.",
    "The install line is for the user to run; never run it, write into the OpenCode skills root, or claim the moved skill ran."
  ]
} satisfies LitOpenCodeRuntimeSkill;

export const visualQaRuntimeSkill = {
  id: "visual-qa",
  title: "Visual QA",
  summary:
    "Pointer: visual-qa moved to wjgoarxiv-skills (design family); the same-name stub says where it went and gives the OpenCode install line.",
  featureIds: ["visual-qa", "doctor-install"],
  discovery:
    "Write a bounded visual-qa or visual qa mention in chat, select the visual-qa OpenCode native skill, or follow the post-edit hint when an interface file changes; each reaches the pointer.",
  safety: [
    "Give no PASS and no FAIL from the pointer; inside a workflow or review, record visual-qa as missing.",
    "The install line is for the user to run; never run it, write into the OpenCode skills root, or claim the moved skill ran."
  ]
} satisfies LitOpenCodeRuntimeSkill;
