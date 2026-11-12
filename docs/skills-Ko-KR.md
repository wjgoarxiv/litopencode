# LitOpenCode 스킬과 명령

[README](../README-Ko-KR.md) · [English](./skills.md) · [사용 안내](./guide-Ko-KR.md) · [상세 안내](./reference-Ko-KR.md)

LitOpenCode가 설치하는 것 전부를, 스킬마다 만들어 내는 결과의 그림과 함께 모았습니다. 예전에는 README에 있던 내용이고, 지금 README에는 처음 쓰는 사람이 가장 먼저 찾는 워크플로 여섯 가지만 남겼습니다.

## 명령어

프롬프트에 `lit`을 붙이거나 슬래시 명령을 입력하면 됩니다. 자주 쓰는 것은 이 정도입니다.

| 입력 | 하는 일 |
| --- | --- |
| 프롬프트 끝의 `lit`, `/lit`, `/litwork` | 범위가 분명한 작업을 시작해 구현하고, 확인한 내용을 기록합니다. |
| `lit-plan` 또는 `/lit-plan` | 구현 전에 계획을 세웁니다. |
| `/start-work <승인된 계획>` | 승인한 계획을 실행합니다. |
| `/review-work` | `lit-plan` 뒤에는 계획을, `lit-loop`나 `/start-work` 뒤에는 끝난 작업을 검토합니다. 있는 것을 보고 고르며 `/review-work plan`, `/review-work work`로 직접 정할 수 있습니다. |
| `lit brainstorm …`, `lit ideation …`, `lit idea …` 또는 `/lit-brainstorm` | 아직 정하지 못한 질문을 여러 선택지로 펼친 뒤 짧은 목록으로 좁히고, 고른 것을 `deep-interview`나 `lit-plan`에 넘깁니다. 직접 만들지는 않습니다. |
| `lit 하이재킹 …`, `lit 하이잭 …`, `lit hijack …` 또는 `/lit-hijack` | 다른 사람이 공개한 글, 논문, 저장소, 영상에서 기법의 원리를 뽑아 내 스킬이나 시스템에 옮깁니다. 출처를 기록하고 라이선스를 확인한 뒤 원문과 분리된 명세로 만들고, 실제 화면에서 달라졌는지 확인합니다. |
| `lit adhd …`, `lit rewind …` 또는 `/lit-adhd` | 하던 일을 이어서 시작합니다. 이 작업 폴더를 읽기 전용 KPI 보드로 보여 줍니다. 지금 할 일 하나와 정확히 입력할 말, 끝남·진행 중·나를 기다림·남음 개수와 전체 진행 막대, 마일스톤, 최근 끝낸 일, 남은 일, 잊지 말 것이 차례로 나옵니다. `go`가 그 단계를 따라가고, `lit adhd 자세히`를 치면 세션별 카드가 보드 아래에 붙습니다. |
| `/litgoal` | 끝나는 지점을 정하고 지킵니다. `lit-loop`와 `/start-work`가 그 목표를 향해 일합니다. |
| `handoff` 또는 `/lit-handoff` | 현재 결과와 다음 할 일을 다음 세션에 넘깁니다. |
| `/lit-recap` | 로컬 기록을 짧게 요약해 보여 줍니다. |
| `/litresearch` 또는 `/lit-research` | 주장마다 출처를 남기며 조사합니다. OpenCode가 허용하면 보조 에이전트가 나눠서 동시에 조사하고, 아니면 차례로 진행합니다. |
| `/lit-code`, `/debugging`, `/refactor` | 코딩, 디버깅, 리팩터링 지침을 씁니다. |
| `/lit-korean` | 의미는 그대로 두고 한국어 문장을 다듬습니다. |
| `/lit-scientific-visualization` | 그림 스킬이 옮겨 간 곳과 OpenCode 설치 줄을 알려 줍니다. |

`handoff`만 단독으로 입력해도 `/lit-handoff`와 똑같이 동작합니다. 대화가 차오를 때 인수인계를 대신 써 주길 원하면 [자동 인수인계](./guide-Ko-KR.md#자동-인수인계)를 보세요.

경로는 작업을 준비할 뿐이고, 실제 작업은 OpenCode 안의 모델이 합니다. 답변에 어떤 단계를 실행했다거나 화면 확인을 통과했다고 나오면, 믿기 전에 파일이나 페이지를 직접 열어 확인하세요.

Autoresearch, Autoconference, Wikify, UI/UX는 [전체 경로 안내](./reference-Ko-KR.md#주요-명령)에, 저장소 규칙을 두 갈래로 읽는 규칙 엔진은 [규칙 엔진 상세 안내](./reference.md#safety-and-updates)에 있습니다. 예전 스킬 이름은 한 릴리스 동안 별칭으로 계속 동작합니다. 목록은 [마이그레이션 안내](./migration.md#skill-id-renames)를 보세요.

## 스킬 한눈에 보기

스킬마다 만들어 내는 결과, 여는 방법, 얻는 것을 한 줄씩 정리했습니다.

<table>
<tr><th>이렇게 됩니다</th><th>스킬</th><th>얻는 것</th></tr>
<tr>
<td><img src="./assets/skills/litwork.webp" width="240" alt="요청에 lit만 붙이세요. 작업이 틀 잡기, 근거 찾기, 계획, 실행, 검증, 리뷰, 정리 순서로 진행됩니다." /></td>
<td><code>litwork</code> · <code>workflow-loop</code><br /><sub><code>lit</code> · <code>/litwork</code></sub></td>
<td>요청에 <code>lit</code>만 붙이세요. 작업이 틀 잡기, 근거 찾기, 계획, 실행, 검증, 리뷰, 정리 순서로 진행됩니다.</td>
</tr>
<tr>
<td><img src="./assets/skills/durable-litgoal.webp" width="240" alt="끝나는 지점을 정하고 지킵니다. 확인 가능한 기준이 붙은 목표 하나를 디스크에 남기고, OpenCode 2.2 이상이면 그 목표를 OpenCode의 /goal에도 세웁니다. lit-loop와 start-work가 그 목표를 향해 일합니다." /></td>
<td><code>litgoal</code><br /><sub><code>/litgoal</code> · <code>/lit-goal</code></sub></td>
<td>끝나는 지점을 정하고 지킵니다. 확인 가능한 기준이 붙은 목표 하나를 디스크에 남기고, OpenCode 2.2 이상이면 그 목표를 OpenCode의 /goal에도 세웁니다. <code>lit-loop</code>와 <code>start-work</code>가 그 목표를 향해 일합니다.</td>
</tr>
<tr>
<td><img src="./assets/skills/lit-plan.webp" width="240" alt="승인 관문에서 멈추는 체크리스트를 만듭니다. lit-plan 에이전트는 파일 수정도, 셸 명령도 할 수 없습니다." /></td>
<td><code>lit-plan</code><br /><sub><code>/lit-plan</code></sub></td>
<td>승인 관문에서 멈추는 체크리스트를 만듭니다. lit-plan 에이전트는 파일 수정도, 셸 명령도 할 수 없습니다.</td>
</tr>
<tr>
<td><img src="./assets/skills/start-work.webp" width="240" alt="승인된 계획을 한 조각씩 실행하고, 승인이나 계획 버전이 낡았으면 멈춥니다." /></td>
<td><code>start-work</code><br /><sub><code>/start-work</code></sub></td>
<td>승인된 계획을 한 조각씩 실행하고, 승인이나 계획 버전이 낡았으면 멈춥니다.</td>
</tr>
<tr>
<td><img src="./assets/skills/review-work.webp" width="240" alt="start-work 전에는 계획을, 끝난 뒤에는 변경을 다섯 방향에서 검토해 심각한 문제부터 보여 주고, 방향마다 통과·실패·미실행을 적습니다." /></td>
<td><code>review-work</code><br /><sub><code>/review-work</code> · <code>/review-work plan</code> · <code>/review-work work</code></sub></td>
<td>두 가지 모드가 있고, 있는 것을 보고 고르거나 직접 정합니다. <code>start-work</code> 전에는 계획 검토, 끝난 뒤에는 작업 검토입니다. 작업 검토는 변경을 다섯 방향에서 살펴 심각한 문제부터 보여 주고, 방향마다 통과·실패·미실행을 적습니다.</td>
</tr>
<tr>
<td><img src="./assets/skills/litresearch.webp" width="240" alt="여러 차례에 걸쳐 조사하고, 주장마다 출처와 아직 불확실한 점을 함께 남깁니다." /></td>
<td><code>litresearch</code><br /><sub><code>lit research &lt;question&gt;</code> · <code>/litresearch</code></sub></td>
<td>여러 차례에 걸쳐 조사하고, 주장마다 출처와 아직 불확실한 점을 함께 남깁니다.</td>
</tr>
<tr>
<td><img src="./assets/skills/doctor-installer.webp" width="240" alt="LitOpenCode를 OpenCode에 설치합니다. --dry-run은 바뀔 내용만 보여주고 아무것도 쓰지 않습니다." /></td>
<td><code>doctor-installer</code><br /><sub><code>litopencode install</code> · <code>litopencode doctor</code></sub></td>
<td>LitOpenCode를 OpenCode에 설치합니다. <code>--dry-run</code>은 바뀔 내용만 보여주고 아무것도 쓰지 않습니다.</td>
</tr>
<tr>
<td><img src="./assets/skills/lit-fetch.webp" width="240" alt="요청이 어디로 갈 수 있는지 먼저 확인한 뒤 공개 페이지를 가져오고, 성공, 페이지 없음, 유료 구독 필요처럼 결과를 이름으로 알려 줍니다." /></td>
<td><code>lit-fetch</code><br /><sub><code>/lit-fetch</code> · <code>litopencode fetch-public &lt;url&gt; --json</code></sub></td>
<td>요청이 어디로 갈 수 있는지 먼저 확인한 뒤 공개 페이지를 가져오고, 성공, 페이지 없음, 유료 구독 필요처럼 결과를 이름으로 알려 줍니다.</td>
</tr>
<tr>
<td><img src="./assets/skills/lit-init.webp" width="240" alt="필요한 폴더에만 짧은 AGENTS.md 안내서를 만듭니다." /></td>
<td><code>lit-init</code><br /><sub><code>/lit-init</code></sub></td>
<td>필요한 폴더에만 짧은 AGENTS.md 안내서를 만듭니다.</td>
</tr>
<tr>
<td><img src="./assets/skills/lit-crucible.webp" width="240" alt="계획 전에 요구사항을 반박해 봅니다. 반박을 견딘 위험만 계획으로 넘어갑니다." /></td>
<td><code>lit-crucible</code><br /><sub><code>/lit-crucible</code></sub></td>
<td>계획 전에 요구사항을 반박해 봅니다. 반박을 견딘 위험만 계획으로 넘어갑니다.</td>
</tr>
<tr>
<td><img src="./assets/skills/refactor.webp" width="240" alt="동작을 테스트로 고정한 채 코드 구조를 바꿉니다. 단계마다 확인합니다." /></td>
<td><code>refactor</code><br /><sub><code>/refactor</code></sub></td>
<td>동작을 테스트로 고정한 채 코드 구조를 바꿉니다. 단계마다 확인합니다.</td>
</tr>
<tr>
<td><img src="./assets/skills/lit-burnoff.webp" width="240" alt="테스트로 동작을 먼저 묶어 두고, 변경분에 붙은 AI식 군더더기를 걷어냅니다." /></td>
<td><code>lit-burnoff</code><br /><sub><code>/lit-burnoff</code></sub></td>
<td>테스트로 동작을 먼저 묶어 두고, 변경분에 붙은 AI식 군더더기를 걷어냅니다.</td>
</tr>
<tr>
<td><img src="./assets/skills/lit-burnoff-file.webp" width="240" alt="방금 수정한 파일 하나를 그 변경분 기준으로 정리합니다." /></td>
<td><code>lit-burnoff-file</code><br /><sub><code>/lit-burnoff-file</code></sub></td>
<td>방금 수정한 파일 하나를 그 변경분 기준으로 정리합니다.</td>
</tr>
<tr>
<td><img src="./assets/skills/lit-code.webp" width="240" alt="필요한 만큼만 코드를 쓰고, Given/When/Then 테스트와 함께 무엇을 정리했는지 적어 둡니다." /></td>
<td><code>lit-code</code><br /><sub><code>/lit-code</code></sub></td>
<td>필요한 만큼만 코드를 쓰고, Given/When/Then 테스트와 함께 무엇을 정리했는지 적어 둡니다.</td>
</tr>
<tr>
<td><img src="./assets/skills/debugging.webp" width="240" alt="버그를 재현하고, 가설을 세 개 이상 세워 확인한 뒤, 확인된 원인만 고칩니다." /></td>
<td><code>debugging</code><br /><sub><code>/debugging</code></sub></td>
<td>버그를 재현하고, 가설을 세 개 이상 세워 확인한 뒤, 확인된 원인만 고칩니다.</td>
</tr>
<tr>
<td><img src="./assets/skills/lit-commit.webp" width="240" alt="변경을 저장소 스타일에 맞는 작은 커밋으로 나눕니다. 관계없는 작업은 건드리지 않습니다." /></td>
<td><code>lit-commit</code><br /><sub><code>/lit-commit</code></sub></td>
<td>변경을 저장소 스타일에 맞는 작은 커밋으로 나눕니다. 관계없는 작업은 건드리지 않습니다.</td>
</tr>
<tr>
<td><img src="./assets/skills/lsp.webp" width="240" alt="OpenCode가 이미 쓰는 언어 서버에서 오류와 경고를 읽어 옵니다. 언어 서버를 따로 설치하지는 않습니다." /></td>
<td><code>lsp</code><br /><sub><code>/lsp</code></sub></td>
<td>OpenCode가 이미 쓰는 언어 서버에서 오류와 경고를 읽어 옵니다. 언어 서버를 따로 설치하지는 않습니다.</td>
</tr>
<tr>
<td><img src="./assets/skills/lsp-setup.webp" width="240" alt="어떤 파일 형식에 언어 서버가 없으면 설치 명령 하나를 제안하고, 승인을 기다립니다." /></td>
<td><code>lsp-setup</code><br /><sub><code>/lsp-setup</code></sub></td>
<td>어떤 파일 형식에 언어 서버가 없으면 설치 명령 하나를 제안하고, 승인을 기다립니다.</td>
</tr>
<tr>
<td><img src="./assets/skills/rules.webp" width="240" alt="저장소 규칙을 두 갈래로 읽습니다. 세션 시작 때 한 번, 파일을 수정할 때 다시 한 번." /></td>
<td><code>rules</code><br /><sub><code>/rules</code></sub></td>
<td>저장소 규칙을 두 갈래로 읽습니다. 세션 시작 때 한 번, 파일을 수정할 때 다시 한 번.</td>
</tr>
<tr>
<td><img src="./assets/skills/deep-interview.webp" width="240" alt="하지 않을 일과 결정 범위가 분명해질 때까지 한 번에 한 질문씩 묻습니다." /></td>
<td><code>deep-interview</code><br /><sub><code>/deep-interview</code></sub></td>
<td>하지 않을 일과 결정 범위가 분명해질 때까지 한 번에 한 질문씩 묻습니다.</td>
</tr>
<tr>
<td><img src="./assets/skills/structural-search.webp" width="240" alt="검색 엔진이 제대로 도는지 먼저 확인하고 문법 구조로 코드를 찾습니다. 글자만 맞춰 찾은 결과에는 TEXTUAL 표시를 붙입니다." /></td>
<td><code>structural-search</code><br /><sub><code>/structural-search</code></sub></td>
<td>검색 엔진이 제대로 도는지 먼저 확인하고 문법 구조로 코드를 찾습니다. 글자만 맞춰 찾은 결과에는 TEXTUAL 표시를 붙입니다.</td>
</tr>
<tr>
<td><img src="./assets/skills/browser-drive.webp" width="240" alt="브라우저 드라이버를 먼저 확인한 뒤 실제 페이지를 조작합니다. 드라이버가 없으면 그렇다고 말합니다." /></td>
<td><code>browser-drive</code><br /><sub><code>/browser-drive</code></sub></td>
<td>브라우저 드라이버를 먼저 확인한 뒤 실제 페이지를 조작합니다. 드라이버가 없으면 그렇다고 말합니다.</td>
</tr>
<tr>
<td><img src="./assets/skills/lit-humanizer.webp" width="240" alt="딱딱한 AI 문장을 한국어나 영어로 다시 씁니다. 사실과 단서는 남기고 군더더기는 뺍니다." /></td>
<td><code>lit-humanizer</code><br /><sub><code>/lit-humanizer</code></sub></td>
<td>딱딱한 AI 문장을 한국어나 영어로 다시 씁니다. 사실과 단서는 남기고 군더더기는 뺍니다.</td>
</tr>
<tr>
<td><img src="./assets/skills/lit-recap.webp" width="240" alt="읽기 전용 요약입니다. 끝난 일, 진행 중인 일, 막힌 곳, 증거 위치, 다음 단계를 보여줍니다." /></td>
<td><code>lit-recap</code><br /><sub><code>/lit-recap</code></sub></td>
<td>읽기 전용 요약입니다. 끝난 일, 진행 중인 일, 막힌 곳, 증거 위치, 다음 단계를 보여줍니다.</td>
</tr>
<tr>
<td><img src="./assets/skills/lit-comprehend.webp" width="240" alt="에이전트가 쓴 작업을 이해하도록 돕는 설명 페이지입니다. 직관, 흐름 설명, 짧은 퀴즈 순서입니다." /></td>
<td><code>lit-comprehend</code><br /><sub><code>/lit-comprehend</code></sub></td>
<td>에이전트가 쓴 작업을 이해하도록 돕는 설명 페이지입니다. 직관, 흐름 설명, 짧은 퀴즈 순서입니다.</td>
</tr>
<tr>
<td><img src="./assets/skills/lit-handoff.webp" width="240" alt="handoff라고 치면 다음 세션이 읽고 이어갈 인수인계 파일이 생깁니다." /></td>
<td><code>lit-handoff</code><br /><sub><code>handoff</code> · <code>/lit-handoff</code></sub></td>
<td><code>handoff</code>라고 치면 다음 세션이 읽고 이어갈 인수인계 파일이 생깁니다.</td>
</tr>
<tr>
<td><img src="./assets/skills/lit-scientific-visualization.webp" width="240" alt="학술지 규격 그림을 벡터와 600 DPI로 내보냅니다. 그래프 종류는 데이터 성격에 맞춰 고릅니다." /></td>
<td><code>lit-scientific-visualization</code><br /><sub>wjgoarxiv-skills로 옮김</sub></td>
<td>학술지 규격 그림을 벡터와 600 DPI로 내보냅니다. 그래프 종류는 데이터 성격에 맞춰 고릅니다.</td>
</tr>
<tr>
<td><img src="./assets/skills/lit-diagram-drawer.webp" width="240" alt="슬라이드와 문서에 넣을 다이어그램을 편집 가능한 형태로 그리고, 검사한 뒤 PNG와 SVG로 내보냅니다." /></td>
<td><code>lit-diagram-drawer</code><br /><sub>wjgoarxiv-skills로 옮김</sub></td>
<td>슬라이드와 문서에 넣을 다이어그램을 편집 가능한 형태로 그리고, 검사한 뒤 PNG와 SVG로 내보냅니다.</td>
</tr>
<tr>
<td><img src="./assets/skills/lit-schematic.webp" width="240" alt="실제 장비의 P&ID, 실험 장치 그림, 아이소메트릭 단면도를 편집 가능한 SVG와 PDF, 600 DPI PNG로 그립니다." /></td>
<td><code>lit-schematic</code><br /><sub>wjgoarxiv-skills로 옮김</sub></td>
<td>실제 장비의 P&amp;ID, 실험 장치 그림, 아이소메트릭 단면도를 편집 가능한 SVG와 PDF, 600 DPI PNG로 그리고 QA 스크립트와 렌더 확인으로 검사합니다.</td>
</tr>
<tr>
<td><img src="./assets/skills/lit-pptx.webp" width="240" alt="lit으로 발표자료를 요청하면 Markdown 원고에서 편집 가능한 PowerPoint 파일을 만듭니다. 만들기 전에 열세 가지 디자인 방향 중 하나를 골라 알려 주고, 덱 전체를 보는 품질 검사와 렌더링 확인을 거칩니다. 스킬 선택기에서도 열 수 있습니다." /></td>
<td><code>lit-pptx</code><br /><sub>wjgoarxiv-skills로 옮김</sub></td>
<td><code>lit</code>으로 발표자료를 요청하면 Markdown 원고에서 편집 가능한 PowerPoint 파일을 만듭니다. 만들기 전에 열세 가지 디자인 방향 중 하나를 골라 알려 주고, 덱 전체를 보는 품질 검사와 렌더링 확인을 거칩니다. 스킬 선택기에서도 열 수 있습니다.</td>
</tr>
<tr>
<td><img src="./assets/skills/lit-docx.webp" width="240" alt="lit으로 보고서를 요청하면 인쇄해도 차분한 Word 파일과 원고 Markdown이 나옵니다. 쓰기 전에 여섯 가지 문서 형식 중 하나를 골라 알려 주며, 학술지 서식도 그대로 씁니다. 렌더링한 페이지까지 검사합니다. 스킬 선택기에서도 열 수 있습니다." /></td>
<td><code>lit-docx</code><br /><sub>wjgoarxiv-skills로 옮김</sub></td>
<td><code>lit</code>으로 보고서를 요청하면 인쇄해도 차분한 Word 파일과 원고 Markdown이 나옵니다. 쓰기 전에 여섯 가지 문서 형식 중 하나를 골라 알려 주며, 학술지 서식도 그대로 씁니다. 렌더링한 페이지까지 검사합니다. 스킬 선택기에서도 열 수 있습니다.</td>
</tr>
<tr>
<td><img src="./assets/skills/autoresearch.webp" width="240" alt="승인된 예산 안에서 실험을 반복합니다. 한 번에 하나만 바꾸고, 결과에 따라 남기거나 되돌립니다." /></td>
<td><code>autoresearch</code><br /><sub><code>/autoresearch</code> · <code>/autoresearch-&lt;mode&gt;</code></sub></td>
<td>승인된 예산 안에서 실험을 반복합니다. 한 번에 하나만 바꾸고, 결과에 따라 남기거나 되돌립니다.</td>
</tr>
<tr>
<td><img src="./assets/skills/autoconference.webp" width="240" alt="예산을 정한 연구 회의입니다. 연구자와 리뷰어가 따로 일하고, 종합에는 반대 의견도 남깁니다." /></td>
<td><code>autoconference</code><br /><sub><code>/autoconference</code> · <code>/autoconference-&lt;mode&gt;</code></sub></td>
<td>예산을 정한 연구 회의입니다. 연구자와 리뷰어가 따로 일하고, 종합에는 반대 의견도 남깁니다.</td>
</tr>
<tr>
<td><img src="./assets/skills/wikify.webp" width="240" alt="검토를 거친 프로젝트 지식을 디스크에 두고, 나중 질문에 출처와 함께 답합니다." /></td>
<td><code>wikify</code><br /><sub><code>/wikify-ingest</code> · <code>/wikify-query</code></sub></td>
<td>검토를 거친 프로젝트 지식을 디스크에 두고, 나중 질문에 출처와 함께 답합니다.</td>
</tr>
<tr>
<td><img src="./assets/skills/frontend-ui-ux.webp" width="240" alt="실제로 동작하는 화면을 만들고, 측정 프로브로 일곱 가지 보기에서 확인합니다. 네 가지 폭, 다크 모드, 모션 줄이기, 200% 확대입니다. 스킬 선택기에서 엽니다." /></td>
<td><code>frontend-ui-ux</code><br /><sub>wjgoarxiv-skills로 옮김</sub></td>
<td>실제로 동작하는 화면을 만들고, 측정 프로브로 일곱 가지 보기에서 확인합니다. 네 가지 폭, 다크 모드, 모션 줄이기, 200% 확대입니다. 스킬 선택기에서 엽니다.</td>
</tr>
<tr>
<td><img src="./assets/skills/readme-studio.webp" width="240" alt="사실에 맞는 README와 확인을 거친 커버, 윤곽선 글자를 만듭니다. 스킬 선택기에서 엽니다." /></td>
<td><code>readme-studio</code><br /><sub>wjgoarxiv-skills로 옮김</sub></td>
<td>사실에 맞는 README와 확인을 거친 커버, 윤곽선 글자를 만듭니다. 스킬 선택기에서 엽니다.</td>
</tr>
<tr>
<td><img src="./assets/skills/lit-typographic-motion.webp" width="240" alt="lit으로 영상을 요청하면 트리트먼트를 먼저 쓰고, 무대 페이지를 그리거나 글자를 움직입니다. 영상은 검사와 눈으로 보는 확인을 거쳐 넘깁니다. 스킬 선택기에서도 열 수 있습니다." /></td>
<td><code>lit-typographic-motion</code><br /><sub>wjgoarxiv-skills로 옮김</sub></td>
<td><code>lit</code>으로 영상을 요청하면 경로·스타일·형식·방식을 한 번에 묻고 트리트먼트를 쓴 뒤, 무대 페이지를 그리거나 글자를 움직입니다. 영상은 기본적으로 풍부하고, 영화마다 겹겹의 점수와 선택형 Blender 3D 플레이트를 갖추며, 검사와 눈으로 보는 확인을 거칩니다. README 커버를 요청하면 이음매가 보이지 않는 무음 루프를 만들고, 완성된 WebP 파일을 그대로 풀어 검사합니다. 스킬 선택기에서도 열 수 있습니다.</td>
</tr>
<tr>
<td><img src="./assets/skills/visual-qa.webp" width="240" alt="실제 화면을 보고 본 것을 그대로 보여 줍니다. 파일을 고칠 권한은 받지 않습니다. 스킬 선택기에서 엽니다." /></td>
<td><code>visual-qa</code><br /><sub>wjgoarxiv-skills로 옮김</sub></td>
<td>실제 화면을 보고 본 것을 그대로 보여 줍니다. 파일을 고칠 권한은 받지 않습니다. 스킬 선택기에서 엽니다.</td>
</tr>
<tr>
<td><img src="./assets/skills/automatic-guards.webp" width="240" alt="알아서 돌아갑니다. LitOpenCode 에이전트를 등록하고, 수정 뒤 주석을 확인하고, 범위 없는 “항상 더 낫다” 주장을 막습니다." /></td>
<td><code>agent-roster</code> · <code>reference-benchmark-claims</code> · <code>native-goal-verdict</code> · <code>search-workflow-ideas</code> · <code>release-guardrails</code> · <code>comment-checker</code> · <code>tool-guards</code><br /><sub>자동 실행</sub></td>
<td>알아서 돌아갑니다. LitOpenCode 에이전트를 등록하고, 수정 뒤 주석을 확인하고, 범위 없는 “항상 더 낫다” 주장을 막습니다.</td>
</tr>
</table>

## 플러그인이 동작하는 방식

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

## wjgoarxiv-skills로 옮긴 스킬

파일과 그림을 만들던 스킬은 wjgoarxiv-skills라는 별도 모음으로 옮겼습니다. 모음은 계열별로 나뉘어 있어 쓰는 스킬만 설치하면 되고, 그만큼 LitOpenCode는 가볍게 유지됩니다. 예전 이름은 짧은 안내 스킬로 남아 있습니다. OpenCode 스킬 선택기, 발표자료·보고서·다이어그램·P&ID·영상을 부탁하는 `lit` 요청, 채팅의 화면 요청, `/lit-scientific-visualization`은 모두 여전히 이 안내로 이어지고, 안내는 스킬이 옮겨 간 곳과 다시 설치하는 방법을 알려 줍니다.

| 스킬 | wjgoarxiv-skills의 계열 |
| --- | --- |
| `lit-pptx` | `decks` |
| `lit-docx` | `documents` |
| `lit-diagram-drawer` | `figures` |
| `lit-schematic` | `figures` |
| `lit-scientific-visualization` | `figures` |
| `frontend-ui-ux` | `design` |
| `visual-qa` | `design` |
| `lit-typographic-motion` | `video-covers` |
| `readme-studio` | `video-covers` |

OpenCode는 이름 하나에 스킬 하나만 두고, 이름이 같은 폴더가 둘이면 어느 쪽을 읽을지 정해져 있지 않습니다. 그래서 복사본은 안내 폴더 옆에 두지 않고 그 자리를 대신합니다. 모음을 https://github.com/wjgoarxiv/wjgoarxiv-skills 에서 한 번 클론한 뒤, 스킬 하나마다 네 줄을 실행합니다. 첫 줄은 OpenCode가 읽는 같은 이름의 폴더(`~/.agents/skills`, `~/.claude/skills`, 프로젝트의 `.opencode/`, `.agents/`, `.claude/` 스킬 폴더 포함)를 보여 주기만 합니다. `~/.config/opencode/skills` 밖의 사본이 나오면 다른 곳으로 옮겨 두세요. 둘째 줄은 안내 폴더를 통째로 `~/.config/opencode/extension-backups/` 아래 날짜 폴더로 옮깁니다. OpenCode 1과 2 모두 그곳에서 스킬을 읽지 않고, 지워지는 것은 없습니다. 셋째 줄은 확장 스킬을 복사합니다. 넷째 줄은 그 안에 `.litfamily-extension.json`을 남깁니다. id, 출처, 변형, 설치 시각을 적은 설치 기록이며 OpenCode는 이 파일을 읽지 않습니다.

```sh
ls -d ~/.config/opencode/skills/lit-docx ~/.agents/skills/lit-docx ~/.claude/skills/lit-docx 2>/dev/null
d=~/.config/opencode/extension-backups/$(date +%Y%m%d-%H%M%S); [ ! -e ~/.config/opencode/skills/lit-docx ] || { mkdir -p "$d" && mv ~/.config/opencode/skills/lit-docx "$d/"; }
mkdir -p ~/.config/opencode/skills && cp -R "<path to your wjgoarxiv-skills clone>/variants/litopencode/lit-docx" ~/.config/opencode/skills/lit-docx
printf '{"id":"%s","source":"%s","variant":"litopencode","installed_at":"%s"}\n' lit-docx "<path to your wjgoarxiv-skills clone>/variants/litopencode/lit-docx" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > ~/.config/opencode/skills/lit-docx/.litfamily-extension.json
```

다른 스킬도 이름만 바꿔 같은 네 줄을 쓰면 되고, 업데이트할 때도 같은 네 줄을 다시 실행합니다. 영상 스킬 `lit-typographic-motion`은 복사한 뒤 글꼴과 고정된 엔진 패키지를 한 번 받아야 합니다. 일반 터미널에서 `node ~/.config/opencode/skills/lit-typographic-motion/runtime.mjs install`을 실행하세요. `litopencode install`과 자동 업데이트는 자신이 쓰지 않은 폴더를 건드리지 않고, `litopencode doctor`는 그 폴더를 preserved로 보여 줍니다. 사본을 빼려면 둘째 줄만 실행하세요. 그다음 `litopencode install`을 실행하면 안내 스킬이 돌아옵니다.

## 글 다듬기와 브라우저

글을 제대로 고쳐 써야 하거나 꼼꼼히 검토받고 싶을 때는 `/lit-humanizer`를 쓰세요. 의미와 글쓴이의 목소리, 꼭 필요한 한정 표현은 그대로 둡니다. 예전 명령인 `/lit-korean`, `/text-naturalization`, `/text-neutralization`, `/korean-ai-slop-remover`도 계속 쓸 수 있고 같은 곳으로 연결됩니다. 에이전트가 쓰는 글도 살펴봅니다. 지원하는 텍스트 파일을 저장하려는데 초안 흔적이 뚜렷하면 저장을 막고, 확신이 낮은 문체 신호는 참고 의견으로만 알려 줍니다. 워드·파워포인트 파일과 텍스트를 뽑아낼 수 있는 PDF는 만들어진 직후에 확인합니다.

`browser-drive`를 쓰려면 [vercel-labs/agent-browser](https://github.com/vercel-labs/agent-browser)의 `agent-browser` 엔진을 직접 설치해야 합니다. `npm install -g agent-browser`와 `agent-browser install`을 실행한 뒤 `node skills/browser-drive/scripts/capability-probe.mjs`로 확인하세요. 검증된 최소 버전은 0.34.0입니다. 형식이 올바른 더 새 버전도 받아들이고, 검증한 버전보다 새것이라고 표시합니다.
