<p align="center"><picture><source media="(prefers-reduced-motion: reduce)" srcset="./docs/assets/cover-motion-still.webp" /><img src="./docs/assets/cover-motion.webp" width="100%" alt="LitFamily 모션 커버: 다섯 로봇 패널이 차례로 켜지고, LitOpenCode 로봇의 눈과 테두리가 빛난 뒤 LITFAMILY와 KEEP THE WORK LIT. 문구가 밝아지는 영상" /></picture></p>

# LitOpenCode

**LitOpenCode는 OpenCode용 워크플로 플러그인입니다. 프롬프트에 `lit`만 붙이면 계획하고, 만들고, 확인하고, 기록까지 남겨서 다음 세션이 어디서 멈췄는지 바로 압니다.**

<p align="center">
<a href="https://www.npmjs.com/package/@litfamily/litopencode"><img src="./docs/assets/readme/badge-version.svg" alt="1.0.18" /></a>
<a href="https://www.npmjs.com/package/@litfamily/litopencode"><img src="https://img.shields.io/npm/dm/@litfamily/litopencode?label=downloads&color=D7F75B" alt="월간 npm 다운로드 수" /></a>
<a href="./LICENSE"><img src="./docs/assets/readme/badge-license.svg" alt="MIT 라이선스" /></a>
<a href="https://github.com/wjgoarxiv/litopencode"><img src="https://img.shields.io/github/stars/wjgoarxiv/litopencode?style=social" alt="GitHub 스타" /></a>
</p>

<p align="center">
<a href="./docs/guide-Ko-KR.md"><img src="./docs/assets/readme/lucide-book-open.svg" width="16" alt="" /> 사용 안내</a> &nbsp; <a href="./docs/screens-Ko-KR.md"><img src="./docs/assets/readme/lucide-play.svg" width="16" alt="" /> 화면</a> &nbsp; <a href="./docs/skills-Ko-KR.md">스킬</a> &nbsp; <a href="./LICENSE"><img src="./docs/assets/readme/lucide-shield-check.svg" width="16" alt="" /> MIT</a> &nbsp; <a href="./README.md">English</a>
</p>

<p align="center"><img src="./docs/assets/demo.webp" width="960" alt="작은 Node 프로젝트에서 실제로 진행한 OpenCode 세션을 짧은 영상으로 만들었고, 기다리는 시간은 줄였으며 카메라가 터미널 위를 움직입니다. 시작 화면에서 Lit-Loop 에이전트가 선택된 상태로 &quot;lit add a --shout flag that prints the greeting in capitals, with a test&quot;를 입력해 보냅니다. 프롬프트 옆에 LIT 마크와 &quot;🔥 LIT IGNITED · lit-task 🔥&quot;가 적힌 알림이 뜹니다. 에이전트는 package.json, greet.js, test/greet.test.js를 읽고, npm test를 돌리고, test/greet.test.js에 --shout 테스트를 추가한 뒤 npm test와 node greet.js Ada --shout를 실행해 HELLO, ADA!가 출력되는 것을 확인합니다. 마지막에 Added --shout to greet.js, Tests pass: 2 tests로 정리합니다. 영상은 LitOpenCode 마크와 설치 명령으로 끝납니다." /></p> <!-- demo-gif -->

*LitOpenCode를 설치한 실제 OpenCode 1.18.35 세션을 터미널에서 녹화한 뒤, 그린 터미널 창 위에서 카메라를 움직이며 다시 재생했습니다. 기다리는 시간을 줄이고 프로젝트 폴더를 `~/greet`로 표시했으며, 나머지 글자는 OpenCode가 출력한 그대로입니다. 설치 화면, 알림, 상태 점검, 잠긴 계획 에이전트 권한, 짧은 영상은 [화면 미리 보기](./docs/screens-Ko-KR.md)에 있습니다.*

## 이런 분께 맞습니다

OpenCode는 눈앞의 대화를 잘 처리합니다. 문제는 그 대화가 끝난 뒤입니다. 세션이 길어지면 대화가 압축되고, 터미널을 닫고 나면 다음 날 아침에는 무엇을 정했고 무엇을 이미 확인했고 무엇이 남았는지부터 다시 맞춰 봐야 합니다. OpenCode에는 세션을 넘어 목표를 보관할 자리가 따로 없습니다.

LitOpenCode는 작업에 일정한 순서와 기억을 붙여 줍니다. 프롬프트에 `lit`을 붙이면 일이 매번 같은 순서를 밟습니다. 무엇을 할지 정리하고, 계획하고, 만들고, 확인한 뒤, 다음 할 일을 적어 둡니다. 이 기록은 프로젝트 안의 `.litopencode/litgoal/`에 쌓이기 때문에 다음 세션은 그 기록을 읽고 멈춘 자리에서 이어 갑니다. 규모가 큰 일은 파일에 손댈 수 없는 에이전트가 먼저 계획을 세우고, 그다음에 실행과 검토를 거칩니다.

OpenCode는 지금 쓰던 그대로 쓰면 됩니다. 모델을 돌리고 권한을 묻는 일은 여전히 OpenCode가 하고, 모델 제공자 로그인도 그대로입니다. 다른 LitFamily 제품을 설치할 필요도 없습니다.

## 빠르게 시작하기

Node.js와 npm, 그리고 모델 제공자를 설정해 둔 [OpenCode](https://opencode.ai)가 있으면 됩니다. 설치는 명령 한 줄입니다.

```sh
npm exec --package @litfamily/litopencode@latest -- litopencode install
```

설치 도중 어떤 모델을 쓸지, 에이전트에게 권한을 얼마나 줄지 묻습니다. 기본값으로 바로 설치하려면 `--yes`를, 아무것도 쓰지 않고 무엇이 바뀔지만 보려면 `--dry-run`을 붙이세요. 권한은 `safe`에서 시작하는데, 무언가 하기 전에 OpenCode가 먼저 물어보는 설정입니다.

OpenCode를 다시 시작하고 **Tab** 키를 눌러 **lit-loop**를 고르세요. 그다음 빈 폴더를 열고 첫 작업을 보냅니다.

```text
lit 외부 의존성 없이 index.html 하나로 할 일 목록을 만들고, 추가와 완료 표시를 확인한 뒤 다음 할 일을 남겨줘.
```

**이렇게 보입니다.** `🔥 LIT IGNITED` 문구와 시작된 워크플로 이름을 담은 알림이 6초 동안 뜹니다. LitOpenCode가 프롬프트를 받았다는 표시입니다. 작업이 끝나면 직접 열어 볼 수 있는 `index.html`이 생기고, 무엇을 만들고 무엇을 확인했는지는 `.litopencode/litgoal/`에 남습니다. 며칠 뒤 돌아와 `/lit-recap`을 입력하면 끝낸 일과 다음 할 일을 알려 줍니다.

실제 작업은 OpenCode 안의 모델이 하고, 모델은 틀릴 수 있습니다. 답변에 무언가 통과했다고 나오면 파일을 직접 열어 확인하세요.

## 할 수 있는 일

**한 단어로 시작합니다.** 요청 끝에 `lit`을 붙이거나 `/lit`을 입력하세요. 일을 정리하고, 계획하고, 만들고, 확인하고, 요약하는 순서로 진행되며 단계마다 나중에 읽을 수 있는 기록이 남습니다.

```text
설정 화면에 다크 모드 토글을 추가하고 기존 테스트가 계속 통과하게 해줘 lit
```

**큰 일은 계획부터 세웁니다.** Tab을 눌러 `lit-plan`을 고르세요. 계획 에이전트는 프로젝트를 읽고 체크리스트를 쓴 뒤 명시적인 사용자 승인을 기다립니다. 파일을 고치거나, 셸 명령을 실행하거나, 다른 에이전트에게 일을 넘길 수는 없습니다. 승인한 계획은 `/start-work`가 한 조각씩 실행하고, `/review-work`가 다섯 가지 관점에서 변경 내용을 검토해 심각한 문제부터 알려 줍니다.

**멈춘 곳에서 이어 갑니다.** `handoff`만 단독으로 입력하거나 `/lit-handoff`를 실행하면 다음 세션이 읽고 이어 갈 인수인계 파일이 남고, `/lit-recap`은 끝낸 일, 막힌 일, 다음 할 일을 다시 읽어 줍니다. 원하면 컨텍스트 창이 차기 전에 [자동 인수인계](./docs/guide-Ko-KR.md#자동-인수인계)가 인수인계를 대신 써 줍니다.

**출처를 남기며 조사합니다.** `/litresearch`는 여러 차례에 걸쳐 조사하고, 주장마다 출처와 아직 불확실한 점을 함께 남깁니다.

```text
lit research 쓰기가 많은 로컬 앱에서 가장 중요한 SQLite 설정은 무엇일까?
```

**보고서, 발표자료, 그림.** 보고서나 발표자료 요청에 `lit`을 붙이면 편집할 수 있는 워드 파일이나 파워포인트 덱이 나옵니다. 마크다운 원고도 함께 남고, 스킬이 먼저 디자인 방향을 골라 이름을 알려 줍니다. 측정 데이터로 학술지 크기의 그림을 만드는 일은 `/lit-scientific-visualization`이, 개념도는 전용 스킬이 맡습니다.

```text
lit notes.md를 금요일 팀 회의용 발표자료 10장으로 만들어줘
```

**사람이 쓴 것 같은 글.** `/lit-humanizer`는 딱딱한 영어나 한국어 문장을 다시 씁니다. 사실관계와 글쓴이의 목소리, 꼭 필요한 한정 표현은 그대로 둡니다.

이 밖에도 디버깅, 리팩터링, 코드 정리, 커밋, 언어 서버, 세션을 시작할 때와 파일을 고칠 때 저장소 규칙을 읽어 오는 `/rules`, 화면 작업, 브라우저 자동화, 프로젝트 위키가 있습니다. 스킬마다 만들어 내는 결과의 그림은 [스킬 갤러리](./docs/skills-Ko-KR.md)에서 볼 수 있습니다.

## 동작 방식

OpenCode는 설정 파일에서 LitOpenCode를 플러그인으로 불러옵니다. 프롬프트나 명령을 보내면 플러그인이 알맞은 워크플로를 고르고, 필요한 스킬을 모델에게 알려 줍니다. 도구와 훅이 일어난 일을 프로젝트에 적어 두고, `/lit-recap`이나 다음 세션이 그 기록을 다시 읽습니다.

```mermaid
flowchart LR
    Prompt["lit을 붙인 프롬프트"] --> Plugin["OpenCode 안의 LitOpenCode 플러그인"]
    Plugin --> Agents["lit-loop, lit-plan, lit-implement와 스킬"]
    Agents --> Record["프로젝트의 .litopencode/litgoal/"]
    Record -->|"/lit-recap, 다음 세션"| Agents
```

설치는 OpenCode 설정(`opencode.jsonc`)에 플러그인을 등록하고, 명령과 스킬 파일을 OpenCode 설정 폴더에 복사하고, 모델 경로 설정을 `~/.config/opencode/litopencode.json`에 저장합니다. 자세한 내용은 [사용 안내](./docs/guide-Ko-KR.md#설치)에 있습니다.

## 준비물, 업데이트, 제거

**준비물.** Node.js와 npm, 그리고 모델 제공자에 로그인해 둔 OpenCode입니다. OpenAI 제공자로 새로 설치하면 계획과 검토는 GPT-6 Astra가, 만들기는 GPT-6 Luna가 맡습니다. 다른 모델은 설치 중에 고를 수 있습니다.

**설치 확인.** `litopencode doctor`는 플러그인과 스킬이 제대로 연결됐는지 알려 줍니다. 읽기만 하고 아무것도 바꾸지 않습니다.

```sh
npm exec --package @litfamily/litopencode@latest -- litopencode doctor
```

**업데이트.** LitOpenCode는 대화형으로 시작할 때와 install이나 doctor가 성공한 뒤에 새 버전을 확인합니다. 끄려면 `--no-auto-update`를 붙이거나 `LITOPENCODE_NO_AUTO_UPDATE=1`을 설정하세요. 설치 명령을 다시 실행해도 업데이트되며, 손봐 둔 모델 경로 설정은 그대로 남습니다.

**제거.** OpenCode의 `opencode.jsonc`에서 `plugin` 배열의 `@litfamily/litopencode` 항목을 지우고 OpenCode를 다시 시작하세요. 전역으로 설치했다면 다음 명령도 실행합니다.

```sh
npm uninstall -g @litfamily/litopencode
```

복사된 명령과 스킬 파일을 정리하는 방법, 다시 쓸 생각이라면 남겨 둘 파일은 [제거 상세 안내](./docs/guide-Ko-KR.md#제거)에 있습니다.

## 더 알아보기

- [사용 안내](./docs/guide-Ko-KR.md): 설치 옵션, 첫 작업과 계획을 세우는 작업, 자동 인수인계, 안전과 업데이트, 프롬프트에 맞는 스킬을 제안하는 선택 기능(Jev), 문제 해결, 완전한 제거 방법
- [스킬과 명령](./docs/skills-Ko-KR.md): 모든 경로와 스킬을 그림과 함께 정리하고, 문서·발표자료·디자인·브라우저 안내까지 담았습니다.
- [화면 미리 보기](./docs/screens-Ko-KR.md): 설치 화면, 상태 점검, 알림, 계획 에이전트가 어떻게 보이는지와 22초짜리 영상
- [워크플로 상세 안내](./docs/reference-Ko-KR.md): 모델, 권한, host 연결, 명령, 검증 방법. 영어판 [English reference](./docs/reference.md)에는 전체 스킬 목록과 규칙 엔진까지 있습니다.
- [마이그레이션 안내](./docs/migration.md) · [Changelog](./CHANGELOG.md) · [개인정보와 네트워크 동작](./docs/privacy.md)
- [그림 자료와 라이선스](./docs/brand-Ko-KR.md) · [터미널 마크와 활성화 확인 문구](./docs/lit-mark.md)
- [출시 체크리스트](./docs/release-checklist.md): 메인테이너용입니다. 이 저장소에만 있고 npm 패키지에는 들어가지 않습니다.
- [LitFamily 허브](https://github.com/wjgoarxiv/litfamily): 같은 `lit` 워크플로를 Claude Code, Codex CLI, Hermes Agent, Grok Build에서도 쓸 수 있습니다. 제품마다 따로 설치하고 따로 동작합니다.

## 기여와 라이선스

"어디까지 했더라?" 하며 보내던 아침을 LitOpenCode가 줄여 줬다면, GitHub 스타 하나가 다른 OpenCode 사용자가 이 프로젝트를 찾는 데 도움이 됩니다.

버그 제보와 풀 리퀘스트를 환영합니다. [기여 안내](./CONTRIBUTING.md)부터 읽어 주시고, [지원](./SUPPORT.md), [보안 제보](./SECURITY.md), [행동 규범](./CODE_OF_CONDUCT.md)도 함께 확인해 주세요.

MIT입니다. [LICENSE](./LICENSE)를 보세요. `lit-handoff`와 `lit-scientific-visualization`에 함께 들어 있는 참조 원본은 `vendor/` 아래에 자체 라이선스·출처 파일과 함께 있습니다.

<details>
<summary>ASCII 로고 복사</summary>

```text
                             ▄▄▄▄
                   ▗███▌   ▗██████▖
 ▗▄▄▄▄▄          ▗▟████▌   ▝██████▘
 ▐█████        ▗▟██████▌    ▝▀▜█▀▘
 ▐█████      ▗▟███████▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄
 ▐█████    ▗▟█████████████████████████ ▐█▀
 ▐█████    ████████████████████████████▀
 ▐█████    ██▛▘   ▄ ▄▄▄▄▖▄▄▄▄▄▄▄▄▄▄▄▄▄▖
 ▐█████    ▀    ▄██ ████▌█████████████▌
 ▐█████       ▄████ ████▌█████████████▌
 ▐█████     ▄█████▛                                 litopencode
 ▐█████  ▗▟█████▀▘       ▄▄▄▄▄     ▗▖
 ▐█████ ▐█████▀          █████     ▐▛▀
 ▐█████ ▐███▀            █████
 ▐█████ ▐█▀              █████
 ▐█████ ▝                █████
 ▐█████▄▄▄▄▄▄▄▖          █████
 ▐███████████▛           █████
 ▐██████████▀            █████

```

</details>

아이콘: [Lucide](./docs/assets/readme/Lucide-LICENSE.txt). ASCII 글리프: [JetBrains Mono, OFL](./docs/assets/readme/JetBrainsMono-OFL.txt).
