<p align="center"><picture><source media="(prefers-reduced-motion: reduce)" srcset="./docs/assets/cover-motion-still.webp" /><img src="./docs/assets/cover-motion.webp" width="100%" alt="LitFamily 모션 커버: 다섯 로봇 패널이 차례로 켜지고, LitOpenCode 로봇의 눈과 테두리가 빛난 뒤 LITFAMILY와 KEEP THE WORK LIT. 문구가 밝아지는 영상" /></picture></p>

<p align="center"><img src="./docs/assets/readme/ascii-readme.svg" width="480" alt="LIT ASCII B 마크" /></p>

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

[English](./README.md) · [한국어](./README-Ko-KR.md)

> **불씨를 건네받았다.**<br>
> **이제, 당신의 작업에 옮길 차례다.**

<p align="center"><img src="./docs/assets/readme/litopencode-wordmark.svg" width="480" alt="LITOPENCODE 디스플레이 타입" /></p>
<p align="center"><img src="./docs/assets/readme/litopencode-clay-icon.png" width="160" alt="LitOpenCode 클레이 마크" /></p>

<p align="center">
<a href="#설치"><img src="./docs/assets/readme/badge-version.svg" alt="1.0.11" /></a>
<a href="./LICENSE"><img src="./docs/assets/readme/badge-license.svg" alt="MIT 라이선스" /></a>
</p>

<p align="center">
<a href="./docs/reference-Ko-KR.md"><img src="./docs/assets/readme/lucide-book-open.svg" width="16" alt="" /> 문서</a> &nbsp; <a href="#설치">설치</a> &nbsp; <a href="#스킬-한눈에-보기">스킬</a> &nbsp; <a href="#ignition-motion"><img src="./docs/assets/readme/lucide-play.svg" width="16" alt="" /> Ignition</a> &nbsp; <a href="./LICENSE"><img src="./docs/assets/readme/lucide-shield-check.svg" width="16" alt="" /> MIT</a>
</p>

LitOpenCode는 OpenCode에 워크플로 agent, 슬래시 명령, 로컬 근거 기록을 더합니다.

OpenCode는 지금 쓰던 그대로 쓰면 됩니다. 프롬프트 끝에 `lit`을 붙이거나 `/lit`을 입력하면 LitOpenCode가 일에 맞는 워크플로를 고릅니다. 모델을 돌리고 권한을 묻는 일은 지금처럼 OpenCode가 하고, 플러그인은 프로젝트에 기록을 남깁니다.

## 왜 만들었나

고치고 싶은 버그 하나. 만들고 싶은 화면 하나. 끝내고 싶은 프로젝트 하나.

시작은 한 줄이면 됩니다. 어려운 건 그다음입니다. 대화가 길어지거나 세션이 끝나면 어디까지 했는지부터 다시 짚어야 합니다. 무엇을 정했고, 무엇을 확인했고, 다음에 무엇을 할지.

LitOpenCode는 그 내용을 프로젝트에 남깁니다. 목표와 계획, 확인한 결과, 다음에 할 일을 적어 두니 다음 세션이 그 기록을 읽고 이어서 작업할 수 있습니다.

```text
계획하기 → 만들기 → 확인하기 → 다음 작업에 건네기
```

“꺼지지 않는 불”이란 세션이 끝나도 다음 세션이 이어받을 수 있게 작업을 남겨 두는 일입니다. 지금 쓰는 도구 안에서 그대로 돌아가고, 다른 LitFamily 제품을 설치할 필요도 없습니다.

## 설치

Node.js와 npm, 그리고 OpenCode가 있으면 됩니다. 다음을 실행하세요.

```sh
LIT_PACKAGE='@litfamily/litopencode@latest'
npm exec --package "$LIT_PACKAGE" -- litopencode install
```

OpenCode를 다시 시작하고 `Tab` 키를 눌러 `lit-loop`를 고르세요.

설치하는 동안 어떤 모델을 쓸지, 에이전트에게 권한을 얼마나 줄지, 답변을 어떤 모양으로 받을지 묻습니다. 권한은 `safe`에서 시작하는데, 무언가 하기 전에 OpenCode가 먼저 물어보는 설정입니다. 로그인과 API 키는 OpenCode에 이미 설정해 둔 모델 제공자(provider) 쪽 것을 그대로 씁니다.

OpenAI 제공자를 쓰면 새로 설치했을 때 계획과 검토는 GPT-6 Astra(`gpt-6-astra`)가 `xhigh`로, 만들기와 조사는 GPT-6 Luna(`gpt-6-luna`)가 `max`로 맡습니다. 지원되는 다른 모델과 추론 수준은 설치 중에 고를 수 있습니다.

바뀔 내용을 먼저 보고 싶거나 질문 없이 설치하려면 둘 중 하나를 붙이세요.

```sh
npm exec --package @litfamily/litopencode@latest -- litopencode install --dry-run  # 변경 사항 미리 보기
npm exec --package @litfamily/litopencode@latest -- litopencode install --yes     # 기본값 사용, 저장된 선택 유지
```

`--dry-run`은 무엇이 바뀔지만 보여 주고 아무것도 쓰지 않습니다. `--yes`는 질문을 건너뛰고 기본값으로 설치하되, 예전에 저장해 둔 선택은 그대로 둡니다.

설치가 하는 일은 많지 않습니다. OpenCode 설정에 플러그인을 등록하고, LitOpenCode의 명령과 스킬 파일을 OpenCode 설정 폴더에 복사합니다. 어떤 일에 어떤 모델을 쓸지 정한 route는 `~/.config/opencode/litopencode.json`에 저장됩니다. `XDG_CONFIG_HOME`을 지정하면 설정 폴더가 통째로 그쪽으로 옮겨 갑니다. 이미 손봐 둔 route는 건드리지 않습니다. 설정 폴더를 직접 정하는 방법, 모델 선택, 터미널 정책, 무인 설치는 [상세 안내](./docs/reference-Ko-KR.md#설치)에 있습니다.

이 체크아웃의 패키지 버전은 `@litfamily/litopencode@1.0.11`입니다. registry의 `@latest`와 다를 수 있으니, 정확한 버전이 중요하면 `npm view @litfamily/litopencode version`으로 확인하세요.

## 첫 작업

작게 시작하세요. 빈 폴더를 OpenCode에서 열고 `lit-loop`를 고른 다음 채팅에 이렇게 보냅니다.

```text
lit 외부 의존성 없이 index.html 하나로 할 일 목록을 만들고, 추가와 완료 표시를 확인한 뒤 다음 할 일을 남겨줘.
```

첫 결과는 `index.html`입니다. 직접 열어서 항목을 추가하고 완료 표시를 해 보세요.

나중에 돌아왔을 때는 `/lit-recap`이 기록을 읽고 다음 할 일을 알려 줍니다.

`/lit`도 같은 워크플로를 시작합니다. 규모가 큰 일은 계획부터 세우는 편이 좋습니다. `lit-plan`을 골라 계획을 읽고 승인한 뒤 `/start-work`로 실행하고, `/review-work`로 마무리합니다. planner는 계획만 세웁니다. 명시적인 사용자 승인을 기다리고, 파일을 고치거나 셸 명령을 실행할 방법이 없습니다. 승인하고 나면 `lit-implement`가 계획을 실제로 수행합니다.

진행 상황과 확인한 결과까지, 기록은 모두 프로젝트의 `.litopencode/litgoal/`에 쌓입니다. OpenCode에는 세션을 넘어 목표를 보관할 곳이 따로 없어서, 다음 세션은 이 폴더를 보고 어디까지 했는지 압니다. 작업 지침만 담긴 스킬도 있는데, 문서에 나온 경로로 그 스킬을 부르면 지침이 작업에 적용됩니다.

## 스킬 한눈에 보기

스킬마다 만들어 내는 결과, 여는 방법, 얻는 것을 한 줄씩 정리했습니다.

<table>
<tr><th>이렇게 됩니다</th><th>스킬</th><th>얻는 것</th></tr>
<tr>
<td><img src="./docs/assets/skills/litwork.webp" width="240" alt="요청에 lit만 붙이세요. 작업이 틀 잡기, 근거 찾기, 계획, 실행, 검증, 리뷰, 정리 순서로 진행됩니다." /></td>
<td><code>litwork</code> · <code>workflow-loop</code><br /><sub><code>lit</code> · <code>/litwork</code></sub></td>
<td>요청에 <code>lit</code>만 붙이세요. 작업이 틀 잡기, 근거 찾기, 계획, 실행, 검증, 리뷰, 정리 순서로 진행됩니다.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/durable-litgoal.webp" width="240" alt="OpenCode에 목표 기능이 없을 때, 확인 가능한 기준이 붙은 목표 하나를 디스크에 남깁니다." /></td>
<td><code>durable-litgoal</code><br /><sub><code>/litgoal</code> · <code>/lit-goal</code></sub></td>
<td>OpenCode에 목표 기능이 없을 때, 확인 가능한 기준이 붙은 목표 하나를 디스크에 남깁니다.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/lit-plan.webp" width="240" alt="승인 관문에서 멈추는 체크리스트를 만듭니다. lit-plan 에이전트는 파일 수정도, 셸 명령도 할 수 없습니다." /></td>
<td><code>lit-plan</code><br /><sub><code>/lit-plan</code></sub></td>
<td>승인 관문에서 멈추는 체크리스트를 만듭니다. lit-plan 에이전트는 파일 수정도, 셸 명령도 할 수 없습니다.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/start-work.webp" width="240" alt="승인된 계획을 한 조각씩 실행하고, 승인이나 계획 버전이 낡았으면 멈춥니다." /></td>
<td><code>start-work</code><br /><sub><code>/start-work</code></sub></td>
<td>승인된 계획을 한 조각씩 실행하고, 승인이나 계획 버전이 낡았으면 멈춥니다.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/review-work.webp" width="240" alt="변경을 다섯 방향에서 검토해 심각한 문제부터 보여 주고, 방향마다 통과·실패·미실행을 적습니다." /></td>
<td><code>review-work</code><br /><sub><code>/review-work</code></sub></td>
<td>변경을 다섯 방향에서 검토해 심각한 문제부터 보여 주고, 방향마다 통과·실패·미실행을 적습니다.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/litresearch.webp" width="240" alt="여러 차례에 걸쳐 조사하고, 주장마다 출처와 아직 불확실한 점을 함께 남깁니다." /></td>
<td><code>litresearch</code><br /><sub><code>lit research &lt;question&gt;</code> · <code>/litresearch</code></sub></td>
<td>여러 차례에 걸쳐 조사하고, 주장마다 출처와 아직 불확실한 점을 함께 남깁니다.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/doctor-installer.webp" width="240" alt="LitOpenCode를 OpenCode에 설치합니다. --dry-run은 바뀔 내용만 보여주고 아무것도 쓰지 않습니다." /></td>
<td><code>doctor-installer</code><br /><sub><code>litopencode install</code> · <code>litopencode doctor</code></sub></td>
<td>LitOpenCode를 OpenCode에 설치합니다. <code>--dry-run</code>은 바뀔 내용만 보여주고 아무것도 쓰지 않습니다.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/lit-fetch.webp" width="240" alt="요청이 어디로 갈 수 있는지 먼저 확인한 뒤 공개 페이지를 가져오고, 성공, 페이지 없음, 유료 구독 필요처럼 결과를 이름으로 알려 줍니다." /></td>
<td><code>lit-fetch</code><br /><sub><code>/lit-fetch</code> · <code>litopencode fetch-public &lt;url&gt; --json</code></sub></td>
<td>요청이 어디로 갈 수 있는지 먼저 확인한 뒤 공개 페이지를 가져오고, 성공, 페이지 없음, 유료 구독 필요처럼 결과를 이름으로 알려 줍니다.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/lit-init.webp" width="240" alt="필요한 폴더에만 짧은 AGENTS.md 안내서를 만듭니다." /></td>
<td><code>lit-init</code><br /><sub><code>/lit-init</code></sub></td>
<td>필요한 폴더에만 짧은 AGENTS.md 안내서를 만듭니다.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/lit-crucible.webp" width="240" alt="계획 전에 요구사항을 반박해 봅니다. 반박을 견딘 위험만 계획으로 넘어갑니다." /></td>
<td><code>lit-crucible</code><br /><sub><code>/lit-crucible</code></sub></td>
<td>계획 전에 요구사항을 반박해 봅니다. 반박을 견딘 위험만 계획으로 넘어갑니다.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/refactor.webp" width="240" alt="동작을 테스트로 고정한 채 코드 구조를 바꿉니다. 단계마다 확인합니다." /></td>
<td><code>refactor</code><br /><sub><code>/refactor</code></sub></td>
<td>동작을 테스트로 고정한 채 코드 구조를 바꿉니다. 단계마다 확인합니다.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/lit-burnoff.webp" width="240" alt="테스트로 동작을 먼저 묶어 두고, 변경분에 붙은 AI식 군더더기를 걷어냅니다." /></td>
<td><code>lit-burnoff</code><br /><sub><code>/lit-burnoff</code></sub></td>
<td>테스트로 동작을 먼저 묶어 두고, 변경분에 붙은 AI식 군더더기를 걷어냅니다.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/lit-burnoff-file.webp" width="240" alt="방금 수정한 파일 하나를 그 변경분 기준으로 정리합니다." /></td>
<td><code>lit-burnoff-file</code><br /><sub><code>/lit-burnoff-file</code></sub></td>
<td>방금 수정한 파일 하나를 그 변경분 기준으로 정리합니다.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/lit-code.webp" width="240" alt="필요한 만큼만 코드를 쓰고, Given/When/Then 테스트와 함께 무엇을 정리했는지 적어 둡니다." /></td>
<td><code>lit-code</code><br /><sub><code>/lit-code</code></sub></td>
<td>필요한 만큼만 코드를 쓰고, Given/When/Then 테스트와 함께 무엇을 정리했는지 적어 둡니다.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/debugging.webp" width="240" alt="버그를 재현하고, 가설을 세 개 이상 세워 확인한 뒤, 확인된 원인만 고칩니다." /></td>
<td><code>debugging</code><br /><sub><code>/debugging</code></sub></td>
<td>버그를 재현하고, 가설을 세 개 이상 세워 확인한 뒤, 확인된 원인만 고칩니다.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/lit-commit.webp" width="240" alt="변경을 저장소 스타일에 맞는 작은 커밋으로 나눕니다. 관계없는 작업은 건드리지 않습니다." /></td>
<td><code>lit-commit</code><br /><sub><code>/lit-commit</code></sub></td>
<td>변경을 저장소 스타일에 맞는 작은 커밋으로 나눕니다. 관계없는 작업은 건드리지 않습니다.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/lsp.webp" width="240" alt="OpenCode가 이미 쓰는 언어 서버에서 오류와 경고를 읽어 옵니다. 언어 서버를 따로 설치하지는 않습니다." /></td>
<td><code>lsp</code><br /><sub><code>/lsp</code></sub></td>
<td>OpenCode가 이미 쓰는 언어 서버에서 오류와 경고를 읽어 옵니다. 언어 서버를 따로 설치하지는 않습니다.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/lsp-setup.webp" width="240" alt="어떤 파일 형식에 언어 서버가 없으면 설치 명령 하나를 제안하고, 승인을 기다립니다." /></td>
<td><code>lsp-setup</code><br /><sub><code>/lsp-setup</code></sub></td>
<td>어떤 파일 형식에 언어 서버가 없으면 설치 명령 하나를 제안하고, 승인을 기다립니다.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/rules.webp" width="240" alt="저장소 규칙을 두 갈래로 읽습니다. 세션 시작 때 한 번, 파일을 수정할 때 다시 한 번." /></td>
<td><code>rules</code><br /><sub><code>/rules</code></sub></td>
<td>저장소 규칙을 두 갈래로 읽습니다. 세션 시작 때 한 번, 파일을 수정할 때 다시 한 번.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/deep-interview.webp" width="240" alt="하지 않을 일과 결정 범위가 분명해질 때까지 한 번에 한 질문씩 묻습니다." /></td>
<td><code>deep-interview</code><br /><sub><code>/deep-interview</code></sub></td>
<td>하지 않을 일과 결정 범위가 분명해질 때까지 한 번에 한 질문씩 묻습니다.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/structural-search.webp" width="240" alt="검색 엔진이 제대로 도는지 먼저 확인하고 문법 구조로 코드를 찾습니다. 글자만 맞춰 찾은 결과에는 TEXTUAL 표시를 붙입니다." /></td>
<td><code>structural-search</code><br /><sub><code>/structural-search</code></sub></td>
<td>검색 엔진이 제대로 도는지 먼저 확인하고 문법 구조로 코드를 찾습니다. 글자만 맞춰 찾은 결과에는 TEXTUAL 표시를 붙입니다.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/browser-drive.webp" width="240" alt="브라우저 드라이버를 먼저 확인한 뒤 실제 페이지를 조작합니다. 드라이버가 없으면 그렇다고 말합니다." /></td>
<td><code>browser-drive</code><br /><sub><code>/browser-drive</code></sub></td>
<td>브라우저 드라이버를 먼저 확인한 뒤 실제 페이지를 조작합니다. 드라이버가 없으면 그렇다고 말합니다.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/lit-humanizer.webp" width="240" alt="딱딱한 AI 문장을 한국어나 영어로 다시 씁니다. 사실과 단서는 남기고 군더더기는 뺍니다." /></td>
<td><code>lit-humanizer</code><br /><sub><code>/lit-humanizer</code></sub></td>
<td>딱딱한 AI 문장을 한국어나 영어로 다시 씁니다. 사실과 단서는 남기고 군더더기는 뺍니다.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/lit-recap.webp" width="240" alt="읽기 전용 요약입니다. 끝난 일, 진행 중인 일, 막힌 곳, 증거 위치, 다음 단계를 보여줍니다." /></td>
<td><code>lit-recap</code><br /><sub><code>/lit-recap</code></sub></td>
<td>읽기 전용 요약입니다. 끝난 일, 진행 중인 일, 막힌 곳, 증거 위치, 다음 단계를 보여줍니다.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/lit-comprehend.webp" width="240" alt="에이전트가 쓴 작업을 이해하도록 돕는 설명 페이지입니다. 직관, 흐름 설명, 짧은 퀴즈 순서입니다." /></td>
<td><code>lit-comprehend</code><br /><sub><code>/lit-comprehend</code></sub></td>
<td>에이전트가 쓴 작업을 이해하도록 돕는 설명 페이지입니다. 직관, 흐름 설명, 짧은 퀴즈 순서입니다.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/lit-handoff.webp" width="240" alt="handoff라고 치면 다음 세션이 읽고 이어갈 인수인계 파일이 생깁니다." /></td>
<td><code>lit-handoff</code><br /><sub><code>handoff</code> · <code>/lit-handoff</code></sub></td>
<td><code>handoff</code>라고 치면 다음 세션이 읽고 이어갈 인수인계 파일이 생깁니다.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/lit-scientific-visualization.webp" width="240" alt="학술지 규격 그림을 벡터와 600 DPI로 내보냅니다. 그래프 종류는 데이터 성격에 맞춰 고릅니다." /></td>
<td><code>lit-scientific-visualization</code><br /><sub><code>/lit-scientific-visualization</code></sub></td>
<td>학술지 규격 그림을 벡터와 600 DPI로 내보냅니다. 그래프 종류는 데이터 성격에 맞춰 고릅니다.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/lit-diagram-drawer.webp" width="240" alt="슬라이드와 문서에 넣을 다이어그램을 편집 가능한 형태로 그리고, 검사한 뒤 PNG와 SVG로 내보냅니다." /></td>
<td><code>lit-diagram-drawer</code><br /><sub><code>skill picker</code></sub></td>
<td>슬라이드와 문서에 넣을 다이어그램을 편집 가능한 형태로 그리고, 검사한 뒤 PNG와 SVG로 내보냅니다.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/lit-pptx.webp" width="240" alt="lit으로 발표자료를 요청하면 Markdown 원고에서 편집 가능한 PowerPoint 파일을 만듭니다. 기본은 AZURE-PRO이고, 품질 검사와 렌더링 확인을 거칩니다. 스킬 선택기에서도 열 수 있습니다." /></td>
<td><code>lit-pptx</code><br /><sub><code>skill picker</code></sub></td>
<td><code>lit</code>으로 발표자료를 요청하면 Markdown 원고에서 편집 가능한 PowerPoint 파일을 만듭니다. 기본은 AZURE-PRO이고, 품질 검사와 렌더링 확인을 거칩니다. 스킬 선택기에서도 열 수 있습니다.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/lit-docx.webp" width="240" alt="lit으로 보고서를 요청하면 서식을 갖춘 Word 파일과 원고 Markdown이 나옵니다. 한국어는 korean-generic 서식을 쓰고, 문체 검사와 렌더링 확인이 뒤따릅니다. 스킬 선택기에서도 열 수 있습니다." /></td>
<td><code>lit-docx</code><br /><sub><code>skill picker</code></sub></td>
<td><code>lit</code>으로 보고서를 요청하면 서식을 갖춘 Word 파일과 원고 Markdown이 나옵니다. 한국어는 korean-generic 서식을 쓰고, 문체 검사와 렌더링 확인이 뒤따릅니다. 스킬 선택기에서도 열 수 있습니다.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/autoresearch.webp" width="240" alt="승인된 예산 안에서 실험을 반복합니다. 한 번에 하나만 바꾸고, 결과에 따라 남기거나 되돌립니다." /></td>
<td><code>autoresearch</code><br /><sub><code>/autoresearch</code> · <code>/autoresearch-&lt;mode&gt;</code></sub></td>
<td>승인된 예산 안에서 실험을 반복합니다. 한 번에 하나만 바꾸고, 결과에 따라 남기거나 되돌립니다.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/autoconference.webp" width="240" alt="예산을 정한 연구 회의입니다. 연구자와 리뷰어가 따로 일하고, 종합에는 반대 의견도 남깁니다." /></td>
<td><code>autoconference</code><br /><sub><code>/autoconference</code> · <code>/autoconference-&lt;mode&gt;</code></sub></td>
<td>예산을 정한 연구 회의입니다. 연구자와 리뷰어가 따로 일하고, 종합에는 반대 의견도 남깁니다.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/wikify.webp" width="240" alt="검토를 거친 프로젝트 지식을 디스크에 두고, 나중 질문에 출처와 함께 답합니다." /></td>
<td><code>wikify</code><br /><sub><code>/wikify-ingest</code> · <code>/wikify-query</code></sub></td>
<td>검토를 거친 프로젝트 지식을 디스크에 두고, 나중 질문에 출처와 함께 답합니다.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/frontend-ui-ux.webp" width="240" alt="실제로 동작하는 화면을 만들고, 측정 프로브로 일곱 가지 보기에서 확인합니다. 네 가지 폭, 다크 모드, 모션 줄이기, 200% 확대입니다. 스킬 선택기에서 엽니다." /></td>
<td><code>frontend-ui-ux</code><br /><sub><code>skill picker</code></sub></td>
<td>실제로 동작하는 화면을 만들고, 측정 프로브로 일곱 가지 보기에서 확인합니다. 네 가지 폭, 다크 모드, 모션 줄이기, 200% 확대입니다. 스킬 선택기에서 엽니다.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/readme-studio.webp" width="240" alt="사실에 맞는 README와 확인을 거친 커버, 윤곽선 글자를 만듭니다. 스킬 선택기에서 엽니다." /></td>
<td><code>readme-studio</code><br /><sub><code>skill picker</code></sub></td>
<td>사실에 맞는 README와 확인을 거친 커버, 윤곽선 글자를 만듭니다. 스킬 선택기에서 엽니다.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/lit-typographic-motion.webp" width="240" alt="lit으로 영상을 요청하면 트리트먼트를 먼저 쓰고, 무대 페이지를 그리거나 글자를 움직입니다. 영상은 검사와 눈으로 보는 확인을 거쳐 넘깁니다. 스킬 선택기에서도 열 수 있습니다." /></td>
<td><code>lit-typographic-motion</code><br /><sub><code>skill picker</code></sub></td>
<td><code>lit</code>으로 영상을 요청하면 트리트먼트를 먼저 쓰고, 무대 페이지를 그리거나 글자를 움직입니다. 영상은 검사와 눈으로 보는 확인을 거쳐 넘깁니다. 스킬 선택기에서도 열 수 있습니다.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/visual-qa.webp" width="240" alt="실제 화면을 보고 본 것을 그대로 보여 줍니다. 파일을 고칠 권한은 받지 않습니다. 스킬 선택기에서 엽니다." /></td>
<td><code>visual-qa</code><br /><sub><code>skill picker</code></sub></td>
<td>실제 화면을 보고 본 것을 그대로 보여 줍니다. 파일을 고칠 권한은 받지 않습니다. 스킬 선택기에서 엽니다.</td>
</tr>
<tr>
<td><img src="./docs/assets/skills/automatic-guards.webp" width="240" alt="알아서 돌아갑니다. LitOpenCode 에이전트를 등록하고, 수정 뒤 주석을 확인하고, 범위 없는 “항상 더 낫다” 주장을 막습니다." /></td>
<td><code>agent-roster</code> · <code>reference-benchmark-claims</code> · <code>native-goal-verdict</code> · <code>search-workflow-ideas</code> · <code>release-guardrails</code> · <code>comment-checker</code> · <code>tool-guards</code><br /><sub>자동 실행</sub></td>
<td>알아서 돌아갑니다. LitOpenCode 에이전트를 등록하고, 수정 뒤 주석을 확인하고, 범위 없는 “항상 더 낫다” 주장을 막습니다.</td>
</tr>
</table>

## A/B 결과

과제마다 가볍게 던지는 한국어 한 줄을 프롬프트로 썼습니다. lit 쪽은 같은 문장 끝에 ` lit`만 붙였습니다.

두 쪽 모두 2026-09-26(UTC)에 OpenCode 1.18.32와 `openai/gpt-6-sol`, 추론 강도 `high`로 실행했습니다. 기준선은 분리된 프로필의 순정 OpenCode이고, lit 쪽은 배포 전 로컬 빌드의 LitOpenCode입니다. 한 쌍은 양쪽 결과를 하나씩 비교합니다. 기준선은 한 번만 실행했고, lit 쪽은 제품을 고친 뒤의 마지막 실행 결과입니다.

표에는 판정 두 개가 나란히 있습니다. 블라인드 심사(Claude Opus 5.5)는 제품 표식을 지운 두 결과를 순서를 바꿔 두 번 비교했고, 두 판정이 엇갈리면 무승부로 셌습니다. 그다음 메인테이너가 두 결과를 나란히 놓고 보고 최종 판정을 내렸습니다.

S3·S4·S11은 인터페이스 라운드, S5·S8·S9는 오피스 라운드 결과이며 같은 과제의 이전 실행을 대신합니다.

| 과제 | 프롬프트 | 최종 판정 | 블라인드 심사 (같은 라운드) |
|---|---|---|---|
| S1 터미널 할 일 CLI | 터미널에서 쓰는 할 일 관리 CLI 만들어줘 | **LitOpenCode 승** | 기준선 승 |
| S2 API 서버 버그 | 이 API 서버 가끔 이상하게 동작하는데 고쳐줘 | **LitOpenCode 승** (블라인드 심사 결과, 눈으로 검토하지 않음) | LitOpenCode 승 |
| S3 가계부 대시보드 | 개인 가계부 대시보드 웹페이지 만들어줘 | **LitOpenCode 승** | LitOpenCode 승 |
| S4 카페 랜딩페이지 | 동네 카페 브랜드 랜딩페이지 만들어줘 | **LitOpenCode 승** | 기준선 승 |
| S5 자료 기반 보고서·발표자료 | sources 폴더 자료로 보고서랑 발표자료 만들어줘 | **LitOpenCode 승** | LitOpenCode 승 |
| S6 Node 22→24 조사 | Node 22에서 24로 올릴 때 달라지는 거 조사해줘 | **LitOpenCode 승** | 무승부 |
| S7 주문·결제·배송 구조도 | 주문-결제-배송 서비스 구조도 그려줘 | **LitOpenCode 승** | LitOpenCode 승 |
| S8 분기 실적 발표자료 | 분기 실적 발표자료 만들어줘 | **LitOpenCode 승** | 기준선 승 |
| S9 신제품 기획서 | 신제품 기획서 써줘 | **LitOpenCode 승** | 무승부 |
| S11 회의실 예약 웹앱 | 회의실 예약 웹앱 만들어줘 | **LitOpenCode 승** | 무승부 |
| 합계 | | **10승** | 4승 3무 3패 |

모션 스킬 `lit-typographic-motion`은 첫 A/B 이후 새로 만들었고, 아직 A/B 결과가 없습니다. 이 README 맨 위 표지는 LitFamily 모션 스킬로 만들었습니다.

### 양쪽이 만든 결과

- **S1.** 두 CLI 모두 처음부터 끝까지 동작했습니다. lit 쪽은 열린 항목·완료 항목 필터와 `--file` 옵션을 더했고 자체 테스트 4개를 통과했습니다(기준선은 3개). 심사는 편집 명령이 있고 저장 폴더를 스스로 만드는 기준선을 골랐지만, 메인테이너는 테스트 4개를 모두 통과한 lit을 택했습니다.
- **S2.** lit은 숨은 오류 6개를 모두 고쳤고(기준선은 5개), README의 잘못된 실행 명령을 바로잡았으며, 항목을 만들면 `201`을 돌려줍니다. 시간대 회귀 테스트는 `TZ`를 따로 지정한 별도 프로세스에서 실행됩니다. 메인테이너가 검토하지 않은 쌍이라 심사 결과를 그대로 썼습니다.
- **S3.** 기준선 대시보드는 화면과 차트가 더 많지만, 맨 위 잔액에 고정 금액을 더해 자기 수입·지출 수치와 맞지 않습니다. lit은 숫자가 서로 맞고, 예시 데이터를 표시해 지울 수 있게 했으며, 다크 모드도 동작합니다. axe 접근성 검사에 걸린 요소는 lit 15개, 기준선 111개였습니다.
- **S4.** 기준선은 가격이 붙은 사진 메뉴와 필터, 주소·영업시간·연락처까지 갖춰 완성된 카페 사이트처럼 보입니다. lit은 픽셀 아트 커피잔을 넣은 콘셉트 페이지 ‘골목의 온도’를 만들었지만, 받은 정보가 없던 주소와 영업시간을 ‘준비 중’으로 남겼고 답변에 규칙 코드가 적힌 점검 표를 붙였습니다. 심사는 이 두 가지를 감점해 기준선을 골랐고, 메인테이너는 lit 페이지를 택했습니다.
- **S5.** lit은 편집 가능한 워드 보고서와 6장짜리 파워포인트 발표자료를 각각 마크다운 원본과 함께 만들고 렌더링 결과를 확인했습니다. 기준선은 보고서와 Marp 호환 발표자료를 마크다운으로만 남겼습니다. 확인한 사실 11개는 양쪽 모두 맞았고 틀린 것은 없었으며, 심사는 lit의 장식적인 표지 슬라이드, 어긋난 글머리표, 남겨 둔 점검 파일을 지적했습니다.
- **S6.** lit의 답에는 `--trace-deprecation`, 롤백 계획, 배포 파이프라인 점검처럼 바로 따라 할 수 있는 단계가 더 많았습니다. 공식 출처 링크 비율은 80% 대 57%, 서로 다른 링크는 10개 대 7개였고, 기준선은 ‘확인할 것’ 열을 둔 간결한 개요였습니다. 심사의 두 판정이 엇갈려 무승부가 됐습니다.
- **S7.** lit은 내부 서비스 경계, 외부 결제 대행사와 택배사, 실패 경로를 담은 편집 가능한 HTML 구조도를 렌더링해 넘겼습니다. 기준선은 데이터베이스, 메시지 브로커, 게이트웨이까지 더 많은 인프라를 설명했지만 Mermaid 코드를 대화에만 남겼습니다. lit은 필요한 브라우저를 쓸 수 없어 PNG를 내보내지 못했다고 밝혔습니다.
- **S8.** 회사명도 실적 수치도 주어지지 않았습니다. 기준선은 입력 칸을 둔 깔끔한 10장짜리 템플릿을 만들었고, lit은 가상 회사를 세워 차트 3개가 들어간 7장짜리 발표자료를 만들면서 모든 수치를 가정이라고 표시했습니다. 심사는 lit의 검은 테두리 상자, 제각각인 막대 색, 장식용 원을 감점해 기준선을 골랐고, 메인테이너는 lit을 택했습니다.
- **S9.** 기준선은 기획서를 대화창에만 쓰고 파일을 만들지 않았습니다. lit은 의사결정 기준, 단위 경제성, 손익분기 계산을 담은 5쪽짜리 편집 가능한 워드 기획서를 썼고, 심사는 ‘예시 가정’ 표시가 너무 잦다고 봤습니다. 심사는 무승부였지만, 메인테이너는 기준선이 문서 파일조차 만들지 못했다는 점을 들어 lit을 택했습니다.
- **S11.** lit 앱에는 겹치는 예약, 시간 칸, 손상된 저장 데이터를 다루는 테스트와 다크 모드가 있고, 답변에 따르면 페이지에서 예약 흐름을 직접 확인했습니다. 기준선은 시간표를 지어낸 예약으로 채우고 회의실 사진을 인터넷에서 불러오며, 가짜 워크스페이스 전환기 같은 장식을 더했습니다. 심사의 두 판정이 엇갈려 무승부가 됐습니다.

### 화면과 문서

인터페이스 라운드, 데스크톱 화면:

| 과제 | 기준선 | LitOpenCode |
|---|---|---|
| S3 | ![S3 기준선 가계부 대시보드, 데스크톱](./docs/ab/S3/baseline-desktop.webp) | ![S3 LitOpenCode 가계부 대시보드, 데스크톱](./docs/ab/S3/lit-desktop.webp) |
| S4 | ![S4 기준선 카페 랜딩페이지, 데스크톱](./docs/ab/S4/baseline-desktop.webp) | ![S4 LitOpenCode 카페 랜딩페이지, 데스크톱](./docs/ab/S4/lit-desktop.webp) |
| S11 | ![S11 기준선 회의실 예약 웹앱, 데스크톱](./docs/ab/S11/baseline-desktop.webp) | ![S11 LitOpenCode 회의실 예약 웹앱, 데스크톱](./docs/ab/S11/lit-desktop.webp) |

<details>
<summary>휴대전화 화면</summary>

| 과제 | 기준선 | LitOpenCode |
|---|---|---|
| S3 | ![S3 기준선 가계부 대시보드, 휴대전화](./docs/ab/S3/baseline-phone.webp) | ![S3 LitOpenCode 가계부 대시보드, 휴대전화](./docs/ab/S3/lit-phone.webp) |
| S4 | ![S4 기준선 카페 랜딩페이지, 휴대전화](./docs/ab/S4/baseline-phone.webp) | ![S4 LitOpenCode 카페 랜딩페이지, 휴대전화](./docs/ab/S4/lit-phone.webp) |
| S11 | ![S11 기준선 회의실 예약 웹앱, 휴대전화](./docs/ab/S11/baseline-phone.webp) | ![S11 LitOpenCode 회의실 예약 웹앱, 휴대전화](./docs/ab/S11/lit-phone.webp) |

</details>

S5, lit 발표자료입니다. 기준선은 마크다운만 남겨 렌더링된 결과가 없습니다.

![S5 LitOpenCode 파워포인트 발표자료](./docs/ab/S5/lit-slides.webp)

S8, 기준선 발표자료와 lit 발표자료입니다.

![S8 기준선 분기 실적 발표자료](./docs/ab/S8/baseline-slides.webp)

![S8 LitOpenCode 분기 실적 발표자료](./docs/ab/S8/lit-slides.webp)

S9, lit 기획서 페이지입니다. 기준선은 파일 없이 대화창에만 답했습니다.

![S9 LitOpenCode 신제품 기획서 페이지](./docs/ab/S9/lit-pages.webp)

S7, lit 구조도입니다.

![S7 LitOpenCode 주문·결제·배송 구조도](./docs/ab/S7/lit-diagram.webp)

## 명령어

프롬프트에 `lit`을 붙이거나 슬래시 명령을 입력하면 됩니다. 자주 쓰는 것은 이 정도입니다.

| 입력 | 하는 일 |
| --- | --- |
| 프롬프트 끝의 `lit`, `/lit`, `/litwork` | 범위가 분명한 작업을 시작해 구현하고, 확인한 내용을 기록합니다. |
| `lit-plan` 또는 `/lit-plan` | 구현 전에 계획을 세웁니다. |
| `/start-work <승인된 계획>` | 승인한 계획을 실행합니다. |
| `/review-work` | 변경 내용과 근거를 검토합니다. |
| `handoff` 또는 `/lit-handoff` | 현재 결과와 다음 할 일을 다음 세션에 넘깁니다. |
| `/lit-recap` | 로컬 기록을 짧게 요약해 보여 줍니다. |
| `/litresearch` 또는 `/lit-research` | 주장마다 출처를 남기며 조사합니다. OpenCode가 허용하면 보조 에이전트가 나눠서 동시에 조사하고, 아니면 차례로 진행합니다. |
| `/lit-code`, `/debugging`, `/refactor` | 코딩, 디버깅, 리팩터링 지침을 씁니다. |
| `/lit-korean` | 의미는 그대로 두고 한국어 문장을 다듬습니다. |
| `/lit-scientific-visualization` | 패키지에 들어 있는 과학 시각화 워크플로를 씁니다. |

`handoff`만 단독으로 입력해도 `/lit-handoff`와 똑같이 동작합니다.

경로는 작업을 준비할 뿐이고, 실제 작업은 OpenCode 안의 모델이 합니다. 답변에 어떤 단계를 실행했다거나 화면 확인을 통과했다고 나오면, 믿기 전에 파일이나 페이지를 직접 열어 확인하세요.

Autoresearch, Autoconference, Wikify, UI/UX는 [전체 경로 안내](./docs/reference-Ko-KR.md#주요-명령)에, 저장소 규칙을 두 갈래로 읽는 규칙 엔진은 [규칙 엔진 상세 안내](./docs/reference.md#safety-and-updates)에 있습니다. 예전 스킬 이름은 한 릴리스 동안 별칭으로 계속 동작합니다. 목록은 [마이그레이션 안내](./docs/migration.md#skill-id-renames)를 보세요.

## 동작 방식

OpenCode는 설정 파일을 읽을 때 플러그인을 불러옵니다. 그 뒤로 프롬프트나 명령을 보내면 LitOpenCode가 알맞은 워크플로와 거기에 필요한 설치 스킬을 고릅니다. 작업이 진행되는 동안 도구와 훅이 일어난 일을 프로젝트에 적어 두고, 나중에 돌아오면 그 기록을 읽고 이어 갑니다.

```mermaid
flowchart TD
    Config["OpenCode 설정: opencode.json / opencode.jsonc"] --> Plugin["LitOpenCode 플러그인"]
    Plugin --> Routes["agent와 채팅 / 명령 경로"]
    Plugin --> Tools["lit / litwork / start-work 도구"]
    Plugin --> Hooks["메시지·도구·세션 hook"]
    Routes --> Skills["설치된 스킬과 canonical 원본"]
    Tools --> Records["프로젝트 기록: .litopencode/litgoal/"]
    Hooks -->|작업 수명주기 이벤트| Records
    Records -->|명시적인 recap 요청| Routes
    classDef host fill:#080D14,stroke:#F2EFDF,color:#F2EFDF
    classDef lit fill:#080D14,stroke:#FF6337,color:#F2EFDF
    classDef local fill:#080D14,stroke:#D7F75B,color:#F2EFDF
    class Config host
    class Plugin,Routes,Tools,Hooks lit
    class Skills,Records local
```

### 경로가 시작될 때 보이는 것

Lit 경로가 시작됐는지는 바로 알 수 있습니다. 답변이 굵은 점화 문구로 시작하고, OpenCode 화면에 경고 모양의 알림이 6초 동안 뜹니다. 터미널이 마크의 특수 문자를 제대로 표시하면 다섯 줄짜리 작은 로고 아래에 `🔥 LIT IGNITED · <discipline> 🔥` 문구가, 그렇지 않으면 그 문구만 나옵니다. 어느 쪽이든 워크플로가 시작됐다는 표시이니, 결과는 작업이 끝난 뒤 직접 확인하세요.

<p align="center"><img src="./docs/assets/litopencode-ignition-1600.webp" width="48%" alt="LitOpenCode 점화 장치" /><img src="./docs/assets/litopencode-continuity-1600.webp" width="48%" alt="LitOpenCode 연속 장치" /></p>

<p align="center"><a href="./docs/assets/readme/ignition-film.mp4"><img src="./docs/assets/readme/poster.png" width="720" alt="Ignition 모션 포스터" /></a></p>

포스터를 누르면 영상이 열립니다. 직접 고르기 전에는 재생되지 않습니다.

### 디자인, README, 다이어그램

`frontend-ui-ux`는 화면을 만드는 스킬입니다. 원하는 것을 충분히 구체적으로 말하면 실제로 동작하는 화면까지 만들고, 렌더링해서 직접 살펴봅니다. 중요한 디자인 선택이 걸릴 때만 묻고, 받은 답은 기억해 둡니다. 검토나 계획을 부탁하면 읽기만 하고 파일은 건드리지 않습니다.

`readme-studio`는 저장소에 실제로 있는 내용으로 README를 쓰고, 표지도 내 컴퓨터에서 만듭니다. 전용 슬래시 명령이 없어서 OpenCode의 스킬 도구에서 고릅니다. 글자를 윤곽선으로 바꾸는 도구, 버전을 고정한 Remotion·HyperFrames 예제, 정적·동적 출력 절차가 함께 설치됩니다. 이미지 생성 도구가 없으면 `IMAGE_GENERATION_UNAVAILABLE`로 알리고, 사용자가 준 배경으로 이어 갑니다. GitHub나 npm에서 최종적으로 어떻게 보이는지는 따로 확인해야 합니다.

`lit-diagram-drawer`는 개념도를 그리고, 내 컴퓨터에서 검사한 뒤 내보냅니다. 렌더러와 브라우저가 이미 있으면 아무것도 새로 설치하지 않고, 기존 다이어그램도 안전하게 가져옵니다. OpenCode 스킬 선택기에서 고르거나, 범위가 분명한 다이어그램 요청 끝에 `lit`을 붙이면 됩니다. 그러면 워크플로가 그리기 전에 이 스킬을 불러오라고 OpenCode에 안내합니다. 전용 슬래시 명령이나 채팅 경로는 따로 없습니다. 제품 화면은 `frontend-ui-ux`, 측정한 과학 데이터 그림은 `lit-scientific-visualization`이 맡습니다.

### 워드 보고서와 발표자료

`lit-docx`는 마크다운 원고로 편집 가능한 워드 보고서를 만들고, `lit-pptx`는 발표자료를 편집 가능한 파워포인트로 컴파일합니다. 보고서나 발표자료 요청에 `lit`을 붙이면 OpenCode가 알맞은 스킬을 불러오도록 안내하고, 둘 다 요청하면 두 스킬을 모두 씁니다.

한국어 보고서는 따로 정하지 않으면 korean-generic 서식을 쓰고, 발표자료는 AZURE-PRO 디자인과 Pretendard 글꼴로 시작합니다. 두 스킬 모두 처음 쓸 때 필요한 도구를 정해진 버전으로 LitOpenCode 전용 캐시에 설치합니다. 완성 파일과 함께 마크다운 원고도 남기고, 구조·품질 검사를 거칩니다. LibreOffice가 있으면 렌더링된 페이지도 눈으로 확인하게 합니다. 출판사 서식, 기존 DOCX 편집, PDF 변환, 템플릿 학습, 글꼴 포함 방법은 설치된 스킬에 설명되어 있습니다. 준비가 됐는지 보려면 `litopencode doctor`를 실행하세요. 상태만 알려 주고 아무것도 설치하지 않습니다.

### 글 다듬기와 브라우저

글을 제대로 고쳐 써야 하거나 꼼꼼히 검토받고 싶을 때는 `/lit-humanizer`를 쓰세요. 의미와 글쓴이의 목소리, 꼭 필요한 한정 표현은 그대로 둡니다. 예전 명령인 `/lit-korean`, `/text-naturalization`, `/text-neutralization`, `/korean-ai-slop-remover`도 계속 쓸 수 있고 같은 곳으로 연결됩니다. 에이전트가 쓰는 글도 살펴봅니다. 지원하는 텍스트 파일을 저장하려는데 초안 흔적이 뚜렷하면 저장을 막고, 확신이 낮은 문체 신호는 참고 의견으로만 알려 줍니다. 워드·파워포인트 파일과 텍스트를 뽑아낼 수 있는 PDF는 만들어진 직후에 확인합니다.

`browser-drive`를 쓰려면 [vercel-labs/agent-browser](https://github.com/vercel-labs/agent-browser)의 `agent-browser` 엔진을 직접 설치해야 합니다. `npm install -g agent-browser`와 `agent-browser install`을 실행한 뒤 `node skills/browser-drive/scripts/capability-probe.mjs`로 확인하세요. 검증된 최소 버전은 0.34.0입니다. 형식이 올바른 더 새 버전도 받아들이고, 검증한 버전보다 새것이라고 표시합니다.

## 안전과 업데이트

planner는 계획만 세웁니다. `lit-plan`은 `edit`, `bash`, `task` 권한이 모두 거부되어 있어서 파일을 고치거나, 명령을 실행하거나, 다른 에이전트에게 일을 넘길 수 없습니다. 나머지 작업의 권한은 `balanced`나 `yolo` 모드를 직접 골라 넓힐 수 있습니다. 그래도 planner는 읽기 전용으로 남고, 보조 에이전트가 또 다른 보조 에이전트를 부를 수도 없습니다.

공개 페이지를 가져올 때는 요청이 어디로 가는지 먼저 확인하고, 리디렉션도 하나하나 검사하며, 받아 오는 양에 한도를 둡니다. 가져온 본문은 데이터로만 읽고, 그 안에 적힌 지시는 따르지 않습니다.

LitOpenCode는 스스로 업데이트할 수 있습니다. 대화형으로 시작할 때와 install이나 doctor가 성공한 뒤에 새 버전을 확인할 수 있는데, 이 확인이 끝날 때까지 기다리므로 잠깐 멈출 수 있습니다. 자동 업데이트를 끄려면 `--no-auto-update`를 붙이거나 `LITOPENCODE_NO_AUTO_UPDATE=1`을 설정하세요.

스킬 학습 기능은 제거되었습니다. 이전 릴리스가 프로젝트의 `.litopencode` 폴더에 남긴 학습 기록이 있더라도, LitOpenCode는 이제 그 파일을 읽지도, 바꾸지도, 지우지도 않습니다. 남겨 둘지 지울지는 직접 정하면 됩니다. [자세한 내용](./docs/reference.md#skill-learning-state)

## Jev 스킬 힌트 (선택)

프롬프트만 봐서는 어떤 스킬이 맞는지 분명하지 않을 때가 있습니다. 이 선택 기능은 바깥 모델에게 한 번 더 의견을 묻습니다. 기본값은 꺼짐입니다.

켜 두면 조건에 맞는 대화 턴마다 TypeSafe가 호스팅하는 판단 모델 Jev에게 이 프롬프트에 맞는 LitOpenCode 스킬이 무엇인지 묻습니다. Jev가 LitOpenCode 스킬 가운데 하나를 충분한 확신으로 고르면, 그 턴에 해당 스킬을 알려 주는 참고 문장 한 줄이 붙습니다. 어디까지나 제안이라서, 스킬을 불러올지는 여전히 모델이 정하고 힌트가 권한을 주거나 도구를 실행하지는 않습니다. 슬래시 명령, 하위 세션, 이미 lit 경로가 처리한 턴, 공백을 뺀 4자 미만의 프롬프트는 건너뜁니다.

켜려면 OpenCode를 실행하는 환경에 두 변수를 모두 설정합니다.

```sh
export LITOPENCODE_JEV=1
export TYPESAFE_API_KEY=<본인의 TypeSafe 키>
```

**켜는 순간부터 조건에 맞는 프롬프트는 내 컴퓨터를 떠나 TypeSafe(typesafe.ai)로 전송됩니다.** 보내기 전에 프롬프트를 2,000자에서 자르고, 홈 경로·이메일 주소·토큰 형태의 문자열을 가립니다. 파일, 도구 출력, 이전 대화는 보내지 않습니다. 나머지는 쓴 그대로 전송되므로 호스트 이름, 고객 이름, `password=...` 형식이 아닌 비밀번호도 함께 넘어갑니다.

키도 조심해서 다뤄야 합니다. `TYPESAFE_API_KEY`는 OpenCode를 실행하는 셸에 export되어 있어서 에이전트의 도구도 이 값을 읽을 수 있습니다. 이 기능 전용 키를 따로 만들고 사용 한도를 낮게 잡아 두세요. 요금은 본인의 TypeSafe 계정에 청구되며, 입력 토큰 100만 개당 약 0.04달러입니다.

힌트 때문에 대화가 오래 멈추지는 않습니다. 요청은 1.5초가 지나면 끊기고 다시 시도하지 않습니다. 실패해도 턴은 평소대로 진행되고, 세션에서 처음 실패했을 때만 짧은 안내가 한 번 붙습니다.

켜져 있는지는 언제든 확인할 수 있습니다. `litopencode doctor`는 `Jev skill hint: off`, `on`, `flag on but TYPESAFE_API_KEY missing` 가운데 하나를 보여 주고, 키는 표시하지 않습니다. 세션마다 조건에 맞는 첫 턴에는 `✦ Jev skill hint is ON` 알림이 한 번 뜹니다. 힌트가 붙은 턴에는 `Jev → lit-humanizer (0.27s)`처럼 스킬 이름과 요청 시간을 담은 짧은 알림이 뜨고, 기능이 꺼져 있거나 맞는 스킬이 없으면 아무 알림도 뜨지 않습니다.

끄려면 `LITOPENCODE_JEV`를 지우거나 `1`이 아닌 값으로 바꿉니다.

세부 변수와 디버그 기록은 [Jev 스킬 힌트 참조 문서](./docs/reference-Ko-KR.md#jev-스킬-힌트-선택)에 있습니다.

## 문제 해결

결과가 에이전트의 완료 보고와 다르면, 실제로 본 것을 에이전트에게 그대로 알려 주세요.

패키지가 제대로 설치됐는지, 설정에 문제가 없는지는 다음 명령으로 확인합니다.

```sh
npm exec --package @litfamily/litopencode@latest -- litopencode doctor
```

더 자세한 내용은 [설치와 모델 설정 안내](./docs/reference-Ko-KR.md#설치)에 있습니다.

스킬 폴더 구성 때문에 헷갈리는 경우가 두 가지 있는데, `install`과 `doctor`가 둘 다 알려 줍니다. 첫째는 스킬 폴더 `<root>/skills`가 다른 곳을 가리키는 심볼릭 링크인 경우입니다. 설치는 링크를 따라가 그 위치에 LitOpenCode 스킬 폴더를 만들기 때문에, 그곳이 git 저장소 안이면 경고를 함께 보여 줍니다. 둘째는 OpenCode가 함께 읽는 다른 폴더, 예를 들어 `~/.agents/skills`, `~/.claude/skills`, 프로젝트 스킬 폴더에 같은 이름의 스킬이 있는 경우입니다. 이때는 OpenCode가 LitOpenCode 대신 그쪽 스킬을 불러올 수 있습니다. 자세한 내용은 [심볼릭 링크된 native 스킬 루트와 다른 위치의 같은 이름 스킬](./docs/reference-Ko-KR.md#심볼릭-링크된-native-스킬-루트와-다른-위치의-같은-이름-스킬)을 보세요.

## 제거

`litopencode uninstall` 명령은 없습니다. 직접 지우려면 다음 순서로 하세요.

1. OpenCode의 `opencode.jsonc`(custom root라면 `opencode.json`)에서 `plugin` 배열의 `@litfamily/litopencode` 또는 `@litfamily/litopencode@<version>` 항목을 지웁니다. 예전 `litopencode` 패키지 항목이 있으면 그것도 지웁니다.
2. 전역으로 설치했다면 npm 실행 파일도 제거합니다.

   ```sh
   npm uninstall -g @litfamily/litopencode
   ```

3. 설치된 명령·스킬 파일은 먼저 살펴본 뒤 설치 도구가 만든 복사본만 지우고, 직접 만들거나 고친 파일은 남깁니다.
4. OpenCode를 다시 시작합니다.

route가 계속 필요하면 `litopencode.json`을, 나중에 작업을 이어 갈 생각이라면 프로젝트의 `.litopencode/` 기록을 남겨 두세요. 자세한 내용은 [제거 상세 안내](./docs/reference-Ko-KR.md#제거)에 있습니다.

## 라이선스

MIT입니다. [LICENSE](./LICENSE)를 보세요.

`lit-handoff`와 `lit-scientific-visualization`에 함께 들어 있는 참조 원본은 `vendor/handoff/`와 `vendor/scientific-visualization/`에 있습니다. 번호가 붙은 라이선스·출처 파일은 출처 기록으로 그대로 둡니다.

## 링크

### 문서

- [워크플로 상세 안내](./docs/reference-Ko-KR.md): 모델, 권한, host 연결, 명령, 검증 방법
- [English reference](./docs/reference.md): 전체 스킬 목록과 규칙 엔진까지 포함
- [마이그레이션 안내](./docs/migration.md)
- [터미널 마크와 활성화 확인 문구](./docs/lit-mark.md)
- [Changelog](./CHANGELOG.md)
- [출시 체크리스트](./docs/release-checklist.md): 메인테이너용입니다. 이 저장소에만 있고 npm 패키지에는 들어가지 않습니다.

### 기여

- [기여 안내](./CONTRIBUTING.md) · [지원](./SUPPORT.md) · [보안 제보](./SECURITY.md)
- [행동 규범](./CODE_OF_CONDUCT.md) · [개인정보와 네트워크 동작](./docs/privacy.md)

### LITFAMILY

![LitClaude, LitHermes, LitCodex, LitOpenCode, LitGrok을 표현한 다섯 중장갑 머신](./docs/assets/readme/litfamily-machines.png)

LitClaude · LitHermes · LitCodex · LitOpenCode · LitGrok.
다섯 중장갑 머신으로 다섯 제품을 표현한 일러스트입니다. 각 제품은 자기 도구 안에서 독립적으로 동작합니다.

### Ignition motion

[![Ignition 모션 그래픽 포스터](./docs/assets/readme/poster.png)](./docs/assets/readme/ignition-film.mp4)

[10초 영상 보기](./docs/assets/readme/ignition-film.mp4) · [애니메이션 GIF](./docs/assets/readme/ignition-readme.gif) · [Lucide 아이콘 라이선스](./docs/assets/readme/Lucide-LICENSE.txt) · [ASCII 글꼴 라이선스](./docs/assets/readme/JetBrainsMono-OFL.txt)

편집할 수 있는 가벼운 벡터 표지는 [docs/assets/cover.svg](./docs/assets/cover.svg)에 있습니다.
