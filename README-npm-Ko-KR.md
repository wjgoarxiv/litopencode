<p align="center"><picture><source media="(prefers-reduced-motion: reduce)" srcset="https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.11/docs/assets/cover-motion-still.webp" /><img src="https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.11/docs/assets/cover-motion.webp" width="100%" alt="LitFamily 모션 커버: 다섯 로봇 패널이 차례로 켜지고, LitOpenCode 로봇의 눈과 테두리가 빛난 뒤 LITFAMILY와 KEEP THE WORK LIT. 문구가 밝아지는 영상" /></picture></p>

<p align="center"><img src="https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.11/docs/assets/readme/ascii-readme.svg" width="480" alt="LIT ASCII B 마크" /></p>

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

# LitOpenCode

[English](https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.11/README.md) · [한국어](https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.11/README-Ko-KR.md)

> **불씨를 건네받았다.**<br>
> **이제, 당신의 작업에 옮길 차례다.**

<p align="center">
<a href="#설치"><img src="https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.11/docs/assets/readme/badge-version.svg" alt="1.0.11" /></a>
<a href="https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.11/LICENSE"><img src="https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.11/docs/assets/readme/badge-license.svg" alt="MIT 라이선스" /></a>
</p>

LitOpenCode는 OpenCode에 워크플로 agent, 슬래시 명령, 로컬 근거 기록을 더합니다.

프롬프트에 `lit`을 붙이면 계획하고, 만들고, 확인한 뒤 다음 할 일을 프로젝트에 적어 둡니다. 그래서 다음 세션이 멈춘 자리에서 바로 이어 갈 수 있습니다. 모델 실행과 권한 질문은 여전히 OpenCode가 맡습니다.

**[전체 안내, 스킬 갤러리, A/B 결과는 GitHub에서 →](https://github.com/wjgoarxiv/litopencode/blob/master/README-Ko-KR.md)**

## 설치

Node.js와 npm, 그리고 OpenCode가 있으면 됩니다.

```sh
LIT_PACKAGE='@litfamily/litopencode@latest'
npm exec --package "$LIT_PACKAGE" -- litopencode install
```

OpenCode를 다시 시작하고 `Tab` 키를 눌러 `lit-loop`를 고르세요. 권한 기본값은 safe/ask-first이고, 모델 접근은 OpenCode의 provider 설정을 그대로 씁니다.

```sh
npm exec --package @litfamily/litopencode@latest -- litopencode install --dry-run  # 변경 사항 미리 보기
npm exec --package @litfamily/litopencode@latest -- litopencode install --yes     # 기본값 사용, 저장된 선택 유지
```

## 첫 작업

빈 폴더를 OpenCode에서 열고 `lit-loop`를 고른 다음 이렇게 보내 보세요.

```text
lit 외부 의존성 없이 index.html 하나로 할 일 목록을 만들고, 추가와 완료 표시를 확인한 뒤 다음 할 일을 남겨줘.
```

`index.html`이 만들어지면 열어서 직접 써 보세요. 다음에 돌아왔을 때는 `/lit-recap`이 어디까지 했는지 알려 줍니다.

## 자주 쓰는 경로

| 입력 | 하는 일 |
| --- | --- |
| `lit` 또는 `/lit` | 범위가 분명한 작업을 시작하고 확인한 내용을 기록합니다. |
| `lit-plan` → `/start-work` → `/review-work` | 계획, 승인, 실행, 검토. planner는 파일을 고치거나 shell을 실행할 수 없습니다. |
| `handoff` 또는 `/lit-handoff` | 현재 결과와 다음 할 일을 다음 세션에 넘깁니다. |
| `/lit-recap` | 로컬 기록을 짧게 요약해 보여 줍니다. |
| `/litresearch` | 출처 근거를 남기며 조사합니다. |

이 밖에도 디버깅, 리팩터링, 코드 검토, 조사 스킬이 있고, 워드 보고서(`lit-docx`)와 파워포인트 발표자료(`lit-pptx`), 다이어그램, 과학 그림, 화면 구현, README, 글 다듬기(`/lit-humanizer`) 스킬도 함께 설치됩니다. 스킬마다 무엇을 만드는지는 그림과 함께 [GitHub 스킬 갤러리](https://github.com/wjgoarxiv/litopencode/blob/master/README-Ko-KR.md#스킬-한눈에-보기)에 있습니다.

## 비교해 보니

가볍게 던지는 한국어 프롬프트 열 개를 순정 OpenCode와 LitOpenCode에 똑같이 보내고, LitOpenCode 쪽 문장 끝에만 ` lit`을 붙였습니다. 최종 판정은 열 개 모두 LitOpenCode 승이었습니다. 아홉 개는 메인테이너가 두 결과를 나란히 보고 판정했고, 메인테이너가 눈으로 검토하지 않은 한 개는 블라인드 심사 결과를 그대로 썼습니다. 다만 제품 표식을 지우고 비교한 블라인드 심사만 따로 보면 LitOpenCode는 4승 3무 3패였습니다. 과제, 두 판정, 양쪽 화면은 [GitHub의 A/B 결과](https://github.com/wjgoarxiv/litopencode/blob/master/README-Ko-KR.md#ab-결과)에 있습니다.

## 설치하면 바뀌는 것

OpenCode 설정 루트에 플러그인을 등록하고 native 명령·스킬 파일을 씁니다. route 파일은 `~/.config/opencode/litopencode.json`이고(`XDG_CONFIG_HOME`을 지정하면 루트가 바뀝니다), 이미 만들어 둔 custom route는 그대로 남습니다. 작업 기록은 프로젝트마다 `.litopencode/litgoal/`에 쌓입니다.

OpenAI provider로 새로 설치하면 계획·검토에는 GPT-6 Astra (`gpt-6-astra`)/`xhigh`, 실행·연구에는 GPT-6 Luna (`gpt-6-luna`)/`max`를 기본으로 씁니다.

## 안전과 업데이트

- `lit-plan`의 `edit`, `bash`, `task`는 계속 거부됩니다. `balanced`와 `yolo`는 직접 골라야 켜지는 모드이고, 어느 쪽을 켜도 planner 보호는 풀리지 않습니다.
- 자동 업데이트는 `--no-auto-update` 또는 `LITOPENCODE_NO_AUTO_UPDATE=1`로 끕니다.
- 스킬 학습 기능은 제거되었습니다. 이전 릴리스가 프로젝트의 `.litopencode` 폴더에 남긴 학습 기록은 이제 아무 역할도 하지 않습니다.
- 선택 기능인 Jev 스킬 힌트는 기본값이 꺼짐입니다. 켜면 조건에 맞는 프롬프트가 TypeSafe로 전송되니, 먼저 [Jev 스킬 힌트 참조 문서](https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.11/docs/reference-Ko-KR.md#jev-스킬-힌트-선택)를 읽어 보세요.
- `npm exec --package @litfamily/litopencode@latest -- litopencode doctor`로 패키지와 설정 상태를 확인할 수 있습니다.

## 제거

별도의 제거 명령은 없습니다. OpenCode의 `opencode.jsonc`(custom root라면 `opencode.json`)에서 `plugin` 배열의 `@litfamily/litopencode` 항목을 지우고 OpenCode를 다시 시작하세요. 전역으로 설치했다면 다음도 실행합니다.

```sh
npm uninstall -g @litfamily/litopencode
```

남겨 둘 만한 설치 파일과 기록은 [제거 상세 안내](https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.11/docs/reference-Ko-KR.md#제거)에 정리되어 있습니다.

## 더 보기

- [GitHub 전체 안내](https://github.com/wjgoarxiv/litopencode/blob/master/README-Ko-KR.md)
- [워크플로 상세 안내](https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.11/docs/reference-Ko-KR.md) · [English reference](https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.11/docs/reference.md)
- [마이그레이션 안내](https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.11/docs/migration.md) · [Changelog](https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.11/CHANGELOG.md) · [개인정보와 네트워크 동작](https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.11/docs/privacy.md)
- [MIT 라이선스](https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.11/LICENSE) · [ASCII 글꼴 라이선스](https://cdn.jsdelivr.net/npm/@litfamily/litopencode@1.0.11/docs/assets/readme/JetBrainsMono-OFL.txt)
