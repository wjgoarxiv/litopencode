<p align="center"><picture><source media="(prefers-reduced-motion: reduce)" srcset="https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.28/docs/assets/cover-motion-still.webp" /><img src="https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.28/docs/assets/cover-motion.webp" width="100%" alt="LitFamily 모션 커버: 다섯 로봇 패널이 차례로 켜지고, LitOpenCode 로봇의 눈과 테두리가 빛난 뒤 LITFAMILY와 KEEP THE WORK LIT. 문구가 밝아지는 영상" /></picture></p>

# LitOpenCode

**LitOpenCode는 OpenCode용 워크플로 플러그인입니다. 프롬프트에 `lit`만 붙이면 계획하고, 만들고, 확인하고, 기록까지 남겨서 다음 세션이 어디서 멈췄는지 바로 압니다.**

<p align="center">
<a href="https://www.npmjs.com/package/@litfamily/litopencode"><img src="https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.28/docs/assets/readme/badge-version.svg" alt="1.0.28" /></a>
<a href="https://www.npmjs.com/package/@litfamily/litopencode"><img src="https://img.shields.io/npm/dm/@litfamily/litopencode?label=downloads&color=D7F75B" alt="월간 npm 다운로드 수" /></a>
<a href="https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.28/LICENSE"><img src="https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.28/docs/assets/readme/badge-license.svg" alt="MIT 라이선스" /></a>
<a href="https://github.com/wjgoarxiv/litopencode"><img src="https://img.shields.io/github/stars/wjgoarxiv/litopencode?style=social" alt="GitHub 스타" /></a>
</p>

LitOpenCode는 목표와 계획, 확인한 내용, 다음 할 일을 프로젝트 안의 `.litopencode/litgoal/`에 남겨 두기 때문에, 긴 작업도 다음 날 멈춘 자리에서 이어 갈 수 있습니다. 몇 세션에 걸쳐 만드는 기능, 계획을 세워 진행하는 리팩터링, 며칠씩 이어 가는 조사, 메모로 만드는 보고서나 발표자료처럼 한 번에 끝나지 않는 OpenCode 작업에 잘 맞습니다.

**[전체 안내, 화면, 스킬 갤러리는 GitHub에서 →](https://github.com/wjgoarxiv/litopencode/blob/main/README-Ko-KR.md)**

## 빠르게 시작하기

Node.js와 npm, 그리고 모델 제공자를 설정해 둔 OpenCode 1.18 또는 1.19가 있으면 됩니다. LitOpenCode는 OpenCode 1용입니다. 플러그인 로딩 방식이 달라진 OpenCode 2는 아직 지원하지 않습니다.

```sh
npm exec --package @litfamily/litopencode@latest -- litopencode install
```

무엇이 바뀔지 먼저 보려면 `--dry-run`을, 기본값으로 질문 없이 설치하려면 `--yes`를 붙이세요. OpenCode를 다시 시작하고 **Tab** 키로 **lit-loop**를 고른 뒤, 빈 폴더를 열고 이렇게 보냅니다.

```text
lit 외부 의존성 없이 index.html 하나로 할 일 목록을 만들고, 추가와 완료 표시를 확인한 뒤 다음 할 일을 남겨줘.
```

직접 열어 볼 수 있는 `index.html`이 생기고, 다음에 돌아오면 `/lit-recap`이 어디까지 했는지 알려 줍니다.

## 할 수 있는 일

| 입력 | 하는 일 |
| --- | --- |
| `lit` 또는 `/lit` | 일을 정리하고, 계획하고, 만들고, 확인하고, 요약하며 단계마다 기록을 남깁니다. |
| `lit-plan` → `/start-work` → `/review-work` | 계획하고, 승인하고, 실행하고, 검토합니다. 계획 에이전트는 파일을 고치거나 셸 명령을 실행할 수 없습니다. |
| `handoff` · `/lit-recap` | 다음 세션이 이어 갈 인수인계 파일을 남기고, 끝낸 일과 다음 할 일을 다시 읽어 줍니다. |
| `/litresearch` | 여러 차례 조사하며 주장마다 출처를 남깁니다. |
| `lit` + 보고서·발표자료 | 마크다운 원고와 함께 편집할 수 있는 워드 보고서나 파워포인트 덱을 만듭니다. |
| `/lit-humanizer` | 딱딱한 영어나 한국어 문장을 사실은 그대로 두고 다시 씁니다. |

스킬마다 만들어 내는 결과의 그림은 [GitHub의 스킬 갤러리](https://github.com/wjgoarxiv/litopencode/blob/main/docs/skills-Ko-KR.md)에서 볼 수 있습니다.

## 업데이트와 제거

LitOpenCode는 대화형으로 시작할 때와 install·doctor가 성공한 뒤 새 버전을 확인합니다. 업데이트 시점을 직접 정하고 싶다면 `--no-auto-update`를 붙이거나 `LITOPENCODE_NO_AUTO_UPDATE=1`을 설정하세요. `npm exec --package @litfamily/litopencode@latest -- litopencode doctor`는 설치 상태를 확인할 뿐 아무것도 바꾸지 않습니다.

제거하려면 OpenCode의 `opencode.jsonc`에서 `plugin` 배열의 `@litfamily/litopencode` 항목을 지우고 OpenCode를 다시 시작하세요. 전역으로 설치했다면 다음 명령도 실행합니다.

```sh
npm uninstall -g @litfamily/litopencode
```

## 더 보기

- [GitHub의 사용 안내](https://github.com/wjgoarxiv/litopencode/blob/main/docs/guide-Ko-KR.md): 설치 옵션, 자동 인수인계, 문제 해결, 제거
- [워크플로 상세 안내](https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.28/docs/reference-Ko-KR.md) · [English reference](https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.28/docs/reference.md)
- [마이그레이션 안내](https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.28/docs/migration.md) · [Changelog](https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.28/CHANGELOG.md) · [개인정보와 네트워크 동작](https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.28/docs/privacy.md)
- [LitFamily 허브](https://github.com/wjgoarxiv/litfamily) · [MIT 라이선스](https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.28/LICENSE) · [ASCII 글꼴 라이선스](https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.28/docs/assets/readme/JetBrainsMono-OFL.txt)

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
