import assert from "node:assert/strict";
import { test } from "node:test";
import { detectChatActivationMode, frontendUiUxModeForPrompt, promptForChatActivationMode } from "../src/activation-routing.ts";

test("interface requests reach the correct scoped mode", () => {
  const cases = [
    ["Build an account screen with editable fields", "build"],
    ["새 목록 화면을 구현해줘", "build"],
    ["Polish the spacing on this card; preserve its layout", "polish"],
    ["이 버튼 스타일만 다듬어줘", "polish"],
    ["Audit this account page read-only", "audit"],
    ["이 화면 점검만 해줘, 코드는 건드리지 말고", "audit"],
    ["Harden the list screen for empty data and long names", "harden"],
    ["이 화면을 좁은 너비에서도 튼튼하게 만들어줘", "harden"],
    ["Polish this card but add a new export button", "build"],
    ["Audit this page and then fix the defects", "build"],
  ];
  for (const [request, expected] of cases) {
    assert.equal(detectChatActivationMode(request), "frontend-ui-ux", request);
    assert.equal(frontendUiUxModeForPrompt(request), expected, request);
    assert.match(promptForChatActivationMode("frontend-ui-ux", request), new RegExp(`Selected interface mode: ${expected}\\.`));
  }
});

test("unrelated media, slides, prose, and infrastructure words stay out of the interface route", () => {
  for (const request of [
    "Edit this video and add captions",
    "이 영상에 자막 넣어줘",
    "모션을 좀 더 부드럽게 만들어줘",
    "발표 자료 표지만 다듬어줘",
    "이 문단 다듬어줘",
    "서버 상태 점검해줘",
    "Audit the deployment pipeline",
  ]) assert.notEqual(detectChatActivationMode(request), "frontend-ui-ux", request);
});
