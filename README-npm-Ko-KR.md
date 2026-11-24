<p align="center"><picture><source media="(prefers-reduced-motion: reduce)" srcset="https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.51/docs/assets/cover-motion-still.webp" /><img src="https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.51/docs/assets/cover-motion.webp" width="100%" alt="LitFamily 모션 커버: 일곱 로봇 패널이 차례로 켜지고, LitOpenCode 로봇의 눈과 테두리가 빛난 뒤 LITFAMILY와 KEEP THE WORK LIT. 문구가 밝아지는 영상" /></picture></p>

# LitOpenCode

**LitOpenCode는 OpenCode에 붙여 쓰는 추가 기능입니다. 에이전트가 "다 됐어요"라고 말하기 전에 자기 작업을 직접 확인하게 하고, 다음 세션이 이번 세션이 멈춘 곳에서 바로 시작하도록 기록을 남깁니다.**

<p align="center">
<a href="https://www.npmjs.com/package/@litfamily/litopencode"><img src="https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.51/docs/assets/readme/badge-version.svg" alt="1.0.51" /></a>
<a href="https://www.npmjs.com/package/@litfamily/litopencode"><img src="https://img.shields.io/npm/dm/@litfamily/litopencode?label=downloads&color=D7F75B" alt="월간 npm 다운로드 수" /></a>
<a href="https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.51/LICENSE"><img src="https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.51/docs/assets/readme/badge-license.svg" alt="MIT 라이선스" /></a>
<a href="https://github.com/wjgoarxiv/litopencode"><img src="https://img.shields.io/github/stars/wjgoarxiv/litopencode?style=social" alt="GitHub 스타" /></a>
</p>

OpenCode에 기능 하나를 부탁하면 코드를 쓰고 끝났다고 말합니다. 그런데 다음 날 보니 테스트는 한 번도 돌지 않았습니다. 새 세션을 열면 프로젝트 설명을 처음부터 다시 해야 합니다. LitOpenCode가 있으면 같은 요청에 `lit`만 붙이면 됩니다. 에이전트는 코드를 먼저 읽고, 고치고, 그 부분을 다루는 테스트를 돌린 다음, 무엇을 확인했고 무엇은 확인하지 못했는지 알려 줍니다. 오래 걸릴 일이면 `lit loop`라고 쓰세요. 이 작업에서 "끝났다"가 무슨 뜻인지 확인 항목으로 `.litopencode/litgoal/`에 먼저 적고, 항목이 모두 통과할 때까지 이어 갑니다. 작업을 멈출 때 `handoff`라고 치면 에이전트가 `HANDOFF.md`에 기록을 남기고, 다음 세션은 그 기록을 읽고 이어서 합니다.

**[전체 안내, 화면, 스킬 갤러리는 GitHub에서 →](https://github.com/wjgoarxiv/litopencode/blob/main/README-Ko-KR.md)**

## 두 가지 사용법

**간단하게.** 설치한 뒤 OpenCode를 다시 시작하면 `lit-loop` 에이전트로 열립니다. 다른 에이전트가 떠 있으면 Tab으로 바꾸면 됩니다. 평소처럼 요청을 쓰고 앞이나 끝에 `lit`을 붙이세요. 예: `src/dates.js의 날짜 파싱 버그 고쳐줘 lit`. `🔥 LIT IGNITED` 알림이 뜨고, 에이전트가 버그를 고치고 테스트를 돌린 뒤 확인한 내용을 알려 줍니다. `lit-plan` 에이전트에서는 같은 문장을 계획 요청으로 받으니, 무언가를 만들 때는 `lit-loop`에 두세요.

**본격적으로.** 큰 작업은 한 단계씩 나아갑니다. 각 단계의 결과를 다음 단계가 이어받고, 필요 없는 단계는 건너뛰면 됩니다.

| 단계 | 입력 | 하는 일 |
| --- | --- | --- |
| 1. 넓게 보기 | `/lit-brainstorm <질문>` | 선택지를 많이 낸 뒤 점수를 매겨 몇 개로 추립니다 |
| 2. 구체화 | `/deep-interview <아이디어>` | 저장소를 먼저 읽고, 코드로는 답이 안 나오는 것만 목표가 분명해질 때까지 묻습니다 |
| 3. 계획 | `/lit-crucible <접근법>` 또는 `/lit-plan <작업>` | crucible은 접근법의 약점을 먼저 찌르고 살아남은 내용을 lit-plan에 넘깁니다. lit-plan은 확인 목록을 쓰고 승인을 기다립니다 |
| 4. 실행 | 계획을 승인한 뒤 `/start-work`, 또는 `/lit-loop <작업>` | 테스트와 확인을 거치며 한 조각씩 진행합니다 |
| 5. 검토 | `/review-work` | 다섯 갈래로 살펴보고 가장 심각한 문제부터 알려 줍니다 |
| 6. 넘겨주기 | `handoff` | 결정한 것과 다음 할 일을 `HANDOFF.md`에 남깁니다 |

설치는 명령 한 줄, `npm exec --package @litfamily/litopencode@latest -- litopencode install`이면 됩니다. 그다음 OpenCode를 다시 시작하세요. 처음 써 보는 전체 과정은 [빠르게 시작하기](#빠르게-시작하기)에 있습니다.

## 빠르게 시작하기

Node.js와 npm, 그리고 모델 제공자를 설정해 둔 OpenCode가 있으면 됩니다. OpenCode 1(1.18.29 이상)과 OpenCode 2를 모두 쓸 수 있고, 둘을 함께 둘 때는 OpenCode 1을 `opencode`로, OpenCode 2를 `opencode2`로 실행합니다. 설치 프로그램이 있는 쪽을 찾아 각각 설정합니다.

```sh
npm exec --package @litfamily/litopencode@latest -- litopencode install
```

무엇이 바뀔지 먼저 보려면 `--dry-run`을, 기본값으로 질문 없이 설치하려면 `--yes`를 붙이세요. OpenCode를 다시 시작하고 **Tab** 키로 **lit-loop**를 고른 뒤, 빈 폴더를 열고 이렇게 보냅니다.

```text
lit 외부 의존성 없이 index.html 하나로 할 일 목록을 만들고, 추가와 완료 표시를 확인한 뒤 다음 할 일을 남겨줘.
```

직접 열어 볼 수 있는 `index.html`이 생기고, 다음에 돌아오면 `/lit-adhd`가 바뀐 것과 지금 할 일 하나를 알려 줍니다.

## 할 수 있는 일

| 입력 | 하는 일 |
| --- | --- |
| `lit` 또는 `/lit` | 일을 정리하고, 계획하고, 만들고, 확인하고, 요약하며 단계마다 기록을 남깁니다. |
| `lit-plan` → `/start-work` → `/review-work` | 계획하고, 승인하고, 실행하고, 검토합니다. 계획 에이전트는 파일을 고치거나 셸 명령을 실행할 수 없습니다. |
| `handoff` · `/lit-adhd` | 다음 세션이 이어 갈 인수인계 파일을 남기고, 돌아오면 바뀐 것, 할 일 하나, 입력할 말을 짧은 카드로 보여 줍니다. `lit adhd recap`은 세션별로 다시 읽어 줍니다. |
| `/ultra-brainstorm` | 몇 개를 띄울지와 비용을 한 번 물은 뒤, 값싼 아이디어 레인 백 개 이상에 한꺼번에 묻습니다. |
| `lit team <목표>` | 이 세션이 목표를 나눠 작은 팀(서브에이전트, worktree, herdr 창)을 굴리고 보고서 하나로 답합니다. |
| `/litresearch` | 여러 차례 조사하며 주장마다 출처를 남깁니다. |
| `lit` + 보고서·발표자료 | 별도 모음인 wjgoarxiv-skills로 옮긴 문서·발표자료 스킬을 안내합니다. |
| `/lit-humanizer` | 딱딱한 영어나 한국어 문장을 사실은 그대로 두고 다시 씁니다. |

스킬마다 만들어 내는 결과의 그림은 [GitHub의 스킬 갤러리](https://github.com/wjgoarxiv/litopencode/blob/main/docs/skills-Ko-KR.md)에서 볼 수 있습니다.

## 확장 스킬

LitOpenCode의 핵심 기능은 그 자체로 완성되어 있어 따로 설치할 것 없이 동작합니다. 파일을 만드는 스킬 아홉 개(발표자료, 문서, 그림, 디자인, 영상·커버)는 LitFamily 확장 스킬로, 확장 스킬 모음 [wjgoarxiv-skills](https://github.com/wjgoarxiv/wjgoarxiv-skills)에 있습니다. 쓰는 스킬을 LitOpenCode와 함께 설치하면 LitFamily의 기능을 빠짐없이 쓸 수 있습니다. `litopencode extensions install <skill>`이 대신 설치해 줍니다. OpenCode가 다른 곳에서 같은 이름의 스킬을 읽으면 멈추고, 할 일을 먼저 출력하며, `--yes`를 붙여야 실행합니다. `list`, `check`, `update`, `remove`, `prune-backups`도 같은 방식입니다. 손으로 하려면 모음을 한 번 내려받고, 스킬마다 다음 네 줄을 실행하세요. 같은 이름의 사본을 확인하고, 안내 폴더를 OpenCode가 읽지 않는 날짜별 백업 폴더로 통째로 옮기고(지우는 것은 없습니다), 확장 스킬을 복사하고, 설치 기록을 남깁니다. 업데이트할 때도 같은 네 줄을 다시 실행합니다.

```sh
ls -d ~/.config/opencode/skills/<skill> ~/.agents/skills/<skill> ~/.claude/skills/<skill> 2>/dev/null
d=~/.config/opencode/extension-backups/$(date +%Y%m%d-%H%M%S); [ ! -e ~/.config/opencode/skills/<skill> ] || { mkdir -p "$d" && mv ~/.config/opencode/skills/<skill> "$d/"; }
mkdir -p ~/.config/opencode/skills && cp -R "<path to your wjgoarxiv-skills clone>/variants/litopencode/<skill>" ~/.config/opencode/skills/<skill>
printf '{"id":"%s","source":"%s","variant":"litopencode","installed_at":"%s"}\n' <skill> "<path to your wjgoarxiv-skills clone>/variants/litopencode/<skill>" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > ~/.config/opencode/skills/<skill>/.litfamily-extension.json
```

## 업데이트와 제거

LitOpenCode는 대화형으로 시작할 때와 install·doctor가 성공한 뒤 새 버전을 확인합니다. 업데이트 시점을 직접 정하고 싶다면 `--no-auto-update`를 붙이거나 `LITOPENCODE_NO_AUTO_UPDATE=1`을 설정하세요. `npm exec --package @litfamily/litopencode@latest -- litopencode doctor`는 설치 상태를 확인할 뿐 아무것도 바꾸지 않습니다.

제거하려면 OpenCode의 `opencode.jsonc`에서 `plugin` 배열의 `@litfamily/litopencode` 항목을 지우고 OpenCode를 다시 시작하세요. 전역으로 설치했다면 다음 명령도 실행합니다.

```sh
npm uninstall -g @litfamily/litopencode
```

## 더 보기

- [GitHub의 사용 안내](https://github.com/wjgoarxiv/litopencode/blob/main/docs/guide-Ko-KR.md): 설치 옵션, 자동 인수인계, 문제 해결, 제거
- [워크플로 상세 안내](https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.51/docs/reference-Ko-KR.md) · [English reference](https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.51/docs/reference.md)
- [마이그레이션 안내](https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.51/docs/migration.md) · [Changelog](https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.51/CHANGELOG.md) · [개인정보와 네트워크 동작](https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.51/docs/privacy.md)
- [LitFamily 허브](https://github.com/wjgoarxiv/litfamily) · [MIT 라이선스](https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.51/LICENSE) · [상표 정책](https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.51/TRADEMARK.md) · [ASCII 글꼴 라이선스](https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.51/docs/assets/readme/JetBrainsMono-OFL.txt)

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
