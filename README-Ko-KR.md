<p align="center"><picture><source media="(prefers-reduced-motion: reduce)" srcset="./docs/assets/cover-motion-still.webp" /><img src="./docs/assets/cover-motion.webp" width="100%" alt="LitFamily 모션 커버: 일곱 로봇 패널이 차례로 켜지고, LitOpenCode 로봇의 눈과 테두리가 빛난 뒤 LITFAMILY와 KEEP THE WORK LIT. 문구가 밝아지는 영상" /></picture></p>

# LitOpenCode

**LitOpenCode는 OpenCode용 워크플로 플러그인입니다. 프롬프트에 `lit`만 붙이면 계획하고, 만들고, 확인하고, 기록까지 남겨서 다음 세션이 어디서 멈췄는지 바로 압니다.**

<p align="center">
<a href="https://www.npmjs.com/package/@litfamily/litopencode"><img src="./docs/assets/readme/badge-version.svg" alt="1.0.34" /></a>
<a href="https://www.npmjs.com/package/@litfamily/litopencode"><img src="https://img.shields.io/npm/dm/@litfamily/litopencode?label=downloads&color=D7F75B" alt="월간 npm 다운로드 수" /></a>
<a href="./LICENSE"><img src="./docs/assets/readme/badge-license.svg" alt="MIT 라이선스" /></a>
<a href="https://github.com/wjgoarxiv/litopencode"><img src="https://img.shields.io/github/stars/wjgoarxiv/litopencode?style=social" alt="GitHub 스타" /></a>
</p>

<p align="center">
<a href="./docs/guide-Ko-KR.md"><img src="./docs/assets/readme/lucide-book-open.svg" width="16" alt="" /> 사용 안내</a> &nbsp; <a href="./docs/screens-Ko-KR.md"><img src="./docs/assets/readme/lucide-play.svg" width="16" alt="" /> 화면</a> &nbsp; <a href="./docs/skills-Ko-KR.md">스킬</a> &nbsp; <a href="./LICENSE"><img src="./docs/assets/readme/lucide-shield-check.svg" width="16" alt="" /> MIT</a> &nbsp; <a href="./README.md">English</a>
</p>

<p align="center"><img src="./docs/assets/demo.webp" width="960" alt="LIT 마크와 함께 LitOpenCode, The lit workflow for OpenCode라고 적힌 타이틀이 나옵니다. 이어서 작은 프로젝트 ~/greet에서 OpenCode가 열리고, 단계마다 번호 붙은 이름표가 지금 일어나는 일을 짚어 줍니다. 1, “lit”으로 시작: OpenCode에 &quot;lit add a --shout flag that prints the greeting in capitals, with a test&quot;를 입력합니다. 2, LitOpenCode가 켜짐: LIT 마크와 &quot;🔥 LIT IGNITED · lit-task 🔥&quot;가 적힌 알림이 뜹니다. 3, 지도에 WORK가 켜짐: 아래쪽 LIT 상태 카드에 🔥 LIT · lit-task가 뜨고, 워크플로 지도 interview – plan – WORK – review – done에서 interview와 plan은 건너뛴 단계로 표시되고 WORK에 불이 들어옵니다. 그 아래에 lit-task 스킬 칩이 붙습니다. 4, 테스트와 함께 고침: test/greet.test.js에 node greet.js --shout Ada를 실행해 HELLO, ADA!를 기대하는 테스트가 추가됩니다. 5, 지금 도는 작업이 보임: npm test가 도는 동안 카드의 지도 옆에 bash · 0:00이 붙습니다. 6, 테스트가 정말 통과함: 테스트 결과에 ok 1이 찍히고, node greet.js --shout Ada가 HELLO, ADA!를 출력합니다. 7, 카드가 가라앉음: 요약에 Done, Added a test, npm test passes가 적히고, 카드는 ○ IDLE로 바뀌어 켜진 단계 없이 lit-task 칩만 회색으로 남습니다. 영상은 LitOpenCode 마크와 설치 명령으로 끝납니다." /></p> <!-- demo-gif -->

## 왜 쓰면 좋을까요

OpenCode는 눈앞의 대화를 잘 처리합니다. 문제는 그 대화가 끝난 뒤입니다. 세션이 길어지면 대화가 압축되고, 터미널을 닫고 나면 다음 날 아침에는 무엇을 정했고 무엇을 이미 확인했고 무엇이 남았는지부터 다시 맞춰 봐야 합니다. OpenCode에는 세션을 넘어 목표를 보관할 자리가 따로 없습니다.

LitOpenCode는 작업에 일정한 순서와 기억을 붙여 줍니다. 프롬프트에 `lit`을 붙이면 일이 매번 같은 순서를 밟습니다. 무엇을 할지 정리하고, 계획하고, 만들고, 확인한 뒤, 다음 할 일을 적어 둡니다. 이 기록은 프로젝트 안의 `.litopencode/litgoal/`에 쌓이기 때문에 다음 세션은 그 기록을 읽고 멈춘 자리에서 이어 갑니다. 규모가 큰 일은 파일에 손댈 수 없는 에이전트가 먼저 계획을 세우고, 그다음에 실행과 검토를 거칩니다.

예를 들면 이렇게 씁니다.

```text
저녁:  lit add a --shout flag that prints the greeting in capitals, with a test
       → 테스트와 함께 플래그가 추가되고, 작업 내용이 .litopencode/litgoal/에 남습니다
아침:  /lit-recap
       → 무엇을 만들었고 무엇을 확인했는지, 다음에 할 일이 무엇인지 알려 줍니다
```

## 빠르게 시작하기

Node.js와 npm, 그리고 모델 제공자를 설정해 둔 [OpenCode](https://opencode.ai)가 있으면 됩니다. OpenCode 1(1.18.29 이상)과 OpenCode 2를 모두 쓸 수 있고, 둘을 함께 둘 때는 OpenCode 1을 `opencode`로, OpenCode 2를 `opencode2`로 실행합니다. 설치 프로그램이 있는 쪽을 찾아 각각 설정합니다. 설치는 명령 한 줄입니다.

```sh
npm exec --package @litfamily/litopencode@latest -- litopencode install
```

설치 도중 어떤 모델을 쓸지, 에이전트에게 권한을 얼마나 줄지 묻습니다. 무엇이 바뀔지 먼저 보고 싶다면 `--dry-run`을 붙이세요. 파일은 건드리지 않고 보여 주기만 합니다. 기본값으로 충분하다면 `--yes`를 붙여 질문을 건너뛸 수 있습니다. 권한은 `safe`에서 시작하는데, 무언가 하기 전에 OpenCode가 먼저 물어보는 설정입니다.

### 코딩 에이전트에게 설치 맡기기

이미 쓰는 에이전트에 아래 내용을 붙여 넣으세요. 에이전트는 먼저 확인하고, 할 일을 보여 준 뒤, 허락을 받고 나서야 무언가를 바꿉니다.

```text
이 컴퓨터에 OpenCode용 lit 워크플로 플러그인 LitOpenCode를 설치해줘.
1. node --version, npm --version, opencode --version으로 Node.js, npm, OpenCode가 설치돼 있는지 확인해. 하나라도 없으면 멈추고 알려줘.
2. 공식 npm 패키지 @litfamily/litopencode만 써. 포크, 미러, curl 스크립트, 다른 패키지는 쓰지 마.
3. 아무것도 바꾸기 전에 이 명령을 실행해: npm exec --package @litfamily/litopencode@latest -- litopencode install --dry-run
   무엇이 바뀌는지 보여 주고, 기본값으로 진행해도 되는지 나한테 물어봐.
4. 내가 좋다고 하면 이 명령을 실행해: npm exec --package @litfamily/litopencode@latest -- litopencode install --yes
   OpenCode 설정 파일은 손으로 고치지 마.
5. 이 명령을 실행해: npm exec --package @litfamily/litopencode@latest -- litopencode doctor
   install.ok, install.plugin.ok, install.nativeSkills.ok가 true인지 알려 주고, 경고가 있으면 그대로 옮겨줘.
6. 마지막으로 OpenCode를 다시 시작하고 Tab을 눌러 lit-loop를 고르라고 알려줘.
```

### 첫 작업 보내기

OpenCode를 다시 시작하고 **Tab** 키를 눌러 **lit-loop**를 고르세요. 그다음 빈 폴더를 열고 이렇게 보냅니다.

```text
lit 외부 의존성 없이 index.html 하나로 할 일 목록을 만들고, 추가와 완료 표시를 확인한 뒤 다음 할 일을 남겨줘.
```

`🔥 LIT IGNITED` 문구와 시작된 워크플로 이름을 담은 알림이 6초 동안 뜹니다. LitOpenCode가 프롬프트를 받았다는 표시입니다. 작업이 끝나면 직접 열어 볼 수 있는 `index.html`이 생기고, 무엇을 만들고 무엇을 확인했는지는 `.litopencode/litgoal/`에 남습니다. 며칠 뒤 돌아와 `/lit-recap`을 입력하면 끝낸 일과 다음 할 일을 알려 줍니다. 설치 화면, 알림, 상태 점검, 잠긴 계획 에이전트 권한은 [화면 미리 보기](./docs/screens-Ko-KR.md)에서 미리 볼 수 있습니다.

실제 작업은 OpenCode 안의 모델이 하고, 모델도 실수를 합니다. 답변에 무언가 통과했다고 나오면 파일을 직접 열어 확인하세요.

## 할 수 있는 일

### 한 단어로 시작하기

요청 끝에 `lit`을 붙이거나 `/lit`을 입력하세요. 일을 정리하고, 계획하고, 만들고, 확인하고, 요약하는 순서로 진행되며 단계마다 나중에 읽을 수 있는 기록이 남습니다.

```text
설정 화면에 다크 모드 토글을 추가하고 기존 테스트가 계속 통과하게 해줘 lit
```

### 큰 일은 계획부터

Tab을 눌러 `lit-plan`을 고르세요. 계획 에이전트는 프로젝트를 읽고 체크리스트를 쓴 뒤 명시적인 사용자 승인을 기다립니다. 파일을 고치거나, 셸 명령을 실행하거나, 다른 에이전트에게 일을 넘길 수는 없습니다. 승인한 계획은 `/start-work`가 한 조각씩 실행하고, `/review-work`가 다섯 가지 관점에서 변경 내용을 검토해 심각한 문제부터 알려 줍니다.

### 멈춘 곳에서 이어 가기

`handoff`만 단독으로 입력하거나 `/lit-handoff`를 실행하면 다음 세션이 읽고 이어 갈 인수인계 파일이 남고, `/lit-recap`은 끝낸 일, 막힌 일, 다음 할 일을 다시 읽어 줍니다. 원하면 컨텍스트 창이 차기 전에 [자동 인수인계](#자동-인수인계)가 인수인계를 대신 써 줍니다.

### 출처를 남기며 조사하기

`/litresearch`는 여러 차례에 걸쳐 조사하고, 주장마다 출처와 아직 불확실한 점을 함께 남깁니다.

```text
lit research 쓰기가 많은 로컬 앱에서 가장 중요한 SQLite 설정은 무엇일까?
```

### 보고서, 발표자료, 그림

보고서나 발표자료 요청에 `lit`을 붙이면 편집할 수 있는 워드 파일이나 파워포인트 덱이 나옵니다. 마크다운 원고도 함께 남고, 스킬이 먼저 디자인 방향을 골라 이름을 알려 줍니다. 측정 데이터로 학술지 크기의 그림을 만드는 일은 `/lit-scientific-visualization`이, 개념도는 전용 스킬이 맡습니다.

```text
lit notes.md를 금요일 팀 회의용 발표자료 10장으로 만들어줘
```

### 사람이 쓴 것 같은 글

`/lit-humanizer`는 딱딱한 영어나 한국어 문장을 다시 씁니다. 사실관계와 글쓴이의 목소리, 꼭 필요한 한정 표현은 그대로 둡니다.

### 그 밖의 기능

이 밖에도 디버깅, 리팩터링, 코드 정리, 커밋, 언어 서버, 세션을 시작할 때와 파일을 고칠 때 저장소 규칙을 읽어 오는 `/rules`, 화면 작업, 브라우저 자동화, 프로젝트 위키가 있습니다. 스킬마다 만들어 내는 결과의 그림은 [스킬 갤러리](./docs/skills-Ko-KR.md)에서 볼 수 있습니다.

## 만들 수 있는 것

아래 그림은 모두 맥 한 대에서 LitOpenCode가 만든 결과이고, 그림 아래에 만든 스킬을 적었습니다. 꾸며 낸 화면은 없습니다. 발표자료와 화면, 도면의 숫자는 가상의 하이드레이트 실험실을 위한 예시 값이며, 각 결과물 안에도 그렇게 적혀 있습니다.

<table>
<tr><td width="50%" valign="top"><img src="./docs/assets/readme/showcase-adhd-brief.webp" width="400" alt="OpenCode 대화창에 뜬 lit-adhd 브리핑. 첫 줄은 1 session · 0 waiting on you · 0 active · next: F1. Plan compliance audit이고, 그 아래에 한 줄짜리 Ended 표, 체크 표시가 붙은 끝난 커밋과 now, later 계획 단계가 이어지는 Roadmap, 상자에 담긴 Recommended next step이 있습니다. 아래쪽 LIT 카드에는 작업 지도와 lit-adhd 칩이 있고, 위 테두리에 REWIND 표시가 있습니다." /><br /><b>lit-adhd</b> · 돌아왔을 때 읽는 브리핑<br /><sub>스킬에 들어 있는 스크립트가 실제 워크트리 묶음의 세션, 커밋, 계획을 읽었습니다. 그 답을 로컬 시험용 모델이 OpenCode에 넘겼고, OpenCode는 이를 색으로 그리며 LIT 카드는 되감기 모양으로 바뀝니다.</sub></td><td width="50%" valign="top"><img src="./docs/assets/readme/showcase-deck.webp" width="400" alt="하이드레이트 장치를 다룬 computational-brutalism 스타일 9장 발표자료의 모음 그림. 어두운 표지, KPI 행, 세 번의 실험의 압력 강하를 그린 네이티브 선 그래프, 결과 표, 두 단 비교, 번호 붙은 네 단계, 어두운 질문 슬라이드, 승인 상자, 부록이 보입니다." /><br /><b>lit-pptx</b> · 9장, computational brutalism<br /><sub>이 페이지를 위해 쓴 슬라이드 원고를 스킬의 엔진이 컴파일했습니다. 그래프는 PowerPoint에서 고칠 수 있고, 발표자료 검사에서 심각한 문제는 나오지 않았습니다.</sub></td></tr>
<tr><td width="50%" valign="top"><img src="./docs/assets/readme/showcase-ui.webp" width="400" alt="하이드레이트 장치의 실험 모니터 화면. 옆 메뉴, 반응기 압력과 액체 온도, 기체 흡수량, 유도 시간을 보여 주는 숫자 카드 네 장, 30분에 유도 표시가 있는 압력 강하 선 그래프, 색 점으로 상태를 나타낸 경보 목록, 제어 루프 패널이 있습니다." /><br /><b>frontend-ui-ux</b> · 실험 모니터 화면<br /><sub>정해 둔 하우스 스타일대로 만든 뒤, 스킬의 점검 도구가 너비 1440, 768, 390, 320 픽셀로 열어 보고 승인했습니다.</sub></td><td width="50%" valign="top"><img src="./docs/assets/readme/showcase-pid.webp" width="400" alt="CO2 하이드레이트 생성 장치의 A3 P&amp;ID. 가스 실린더에서 레귤레이터, 필터, 질량 유량 제어기, 밸브를 거쳐 재킷 교반 반응기로 들어가는 라인, 물 탱크와 공급 펌프, 온도 제어기가 붙은 글리콜 칠러 루프, 후드 배기로 가는 배압 벤트와 안전밸브, ISA 계기 기호, 범례, 표제란이 있습니다." /><br /><b>lit-schematic</b> · A3 한 장짜리 P&amp;ID<br /><sub>이 페이지를 위해 쓴 빌드 파일을 스킬의 P&amp;ID 도구로 그렸습니다. 기호 24개, ISA 태그, 라인 번호, 표제란이 있고 도면 검사를 통과했습니다.</sub></td></tr>
</table>

다른 스킬의 결과 그림은 [스킬 갤러리](./docs/skills-Ko-KR.md)에서 볼 수 있습니다.

## 이런 분께 맞습니다

이미 OpenCode로 한 번에 끝나지 않는 일을 하는 분께 어울립니다. 몇 세션에 걸쳐 만드는 기능, 계획을 세워 진행하는 리팩터링, 며칠에 걸쳐 이어 가는 조사, 메모로 만드는 보고서나 발표자료 같은 일입니다. 바꾼 내용을 확인하고 검토까지 마친 뒤에야 끝냈다고 보는 분께도 잘 맞습니다.

OpenCode는 지금 쓰던 그대로 쓰면 됩니다. 모델을 돌리고 권한을 묻는 일은 여전히 OpenCode가 하고, 모델 제공자 로그인도 그대로입니다. 다른 LitFamily 제품을 설치할 필요도 없습니다.

## LIT 상태 카드

LitOpenCode를 설치하면 OpenCode 세션 화면 맨 아래에 작은 카드가 붙습니다. 카드는 세션 내내 그 자리에 있고, 작업이 돌든 안 돌든 같은 네 줄을 유지하기 때문에 프롬프트 입력 칸이 위아래로 움직이지 않습니다.

첫 `lit` 프롬프트를 보내기 전에는 카드가 조용합니다. 제목에는 `🔥 LIT · ready`와 `○ IDLE`이 보이고, 작업 흐름 지도는 흐리며, 어떻게 시작하면 되는지 알려 줍니다. 아래 테두리에는 컨텍스트 창이 얼마나 찼는지와 지금 git 브랜치가 나옵니다.

<p align="center"><img src="./docs/assets/readme/status-card-idle.webp" width="760" alt="lit 프롬프트를 보내기 전 OpenCode의 LIT 상태 카드. 위 테두리 왼쪽에 🔥 LIT · ready, 오른쪽에 ○ IDLE이 적혀 있다. 첫 줄에는 흐린 작업 흐름 지도 interview ─ plan ─ work ─ review ─ done과 add lit to a prompt to start가, 둘째 줄에는 skills none yet이 있고, 아래 테두리에는 ctx 4% · ⎇ main이 보인다." /></p>

`lit`을 붙인 프롬프트를 보내면 카드가 깨어납니다. 제목에 워크플로 이름과 지금 단계가 나오고, 지도는 그 단계를 개수와 함께 밝힙니다. 아래 lit-loop 요청은 목표 기준 세 개 가운데 하나를 통과했으므로 지도가 `CRITERION 1/3`으로 보이고, 하지 않고 지나간 단계에는 `–`가 붙으며, 막대는 끝난 몫을 보여 줍니다. 도구가 도는 동안에는 막대 옆에 도구 이름과 걸린 시간이 나옵니다. 요청이 쓰는 LitOpenCode 스킬마다 밝은 칩이 하나씩 붙고, 새 칩이 붙을 때는 빛이 한 번 훑고 지나갑니다. 앞선 차례에 쓴 스킬은 회색으로 남습니다.

<p align="center"><img src="./docs/assets/readme/status-card-working.webp" width="760" alt="lit-loop 요청이 진행 중인 LIT 상태 카드. 위 테두리에 🔥 LIT · lit-loop과 오른쪽 ● CRITERION이 적혀 있고, 분홍색 LIT 글자가 눈에 띈다. 첫 줄에는 작업 흐름 지도 interview – ━ plan – ━ CRITERION 1/3 ─ review ─ done이 있고 지금 단계는 하늘색으로 채운 알약으로 보이며, 3분의 1쯤 찬 막대와 지금 하는 일 ⠏ bash · 0:09가 이어진다. 둘째 줄은 skills lit-loop이고 lit-loop이 밝은 하늘색 칩이다. 아래 테두리에는 ctx 4% · ⟳ 0m · ⎇ main이 보인다." /></p>

차례가 끝나면 카드가 가라앉습니다. 제목이 `○ IDLE`로 바뀌고, 밝게 켜진 단계가 없어지며, 지금 하는 일 자리에는 다음에 할 항목이 들어갑니다. 칩은 흐려지지만 사라지지 않고 가장 최근에 쓴 것부터 남아 무엇이 돌았는지 보여 줍니다. 다음 프롬프트를 보내면 카드가 다시 깨어납니다. 같은 스킬을 다시 쓰면 그 칩이 다시 밝아지고, 칩이 자리보다 많으면 나머지는 `+N`으로 접힙니다.

<p align="center"><img src="./docs/assets/readme/status-card-recent.webp" width="760" alt="차례가 끝난 뒤의 LIT 상태 카드. 제목은 🔥 LIT · lit-loop과 ○ IDLE이다. 지도 interview – ━ plan – ━ criterion ─ review ─ done에는 밝게 켜진 단계가 없고, 막대는 여전히 3분의 1을 보여 주며, ▸ C2 the default greeting…이 다음 기준을 알려 준다. lit-loop 칩은 이제 회색이다. 아래 테두리에는 ctx 6% · ⟳ 0m · ⎇ main이 보인다." /></p>

단계 표시는 작업 흐름 전체를 담은 지도입니다. 인터뷰로 시작한 요청은 `interview › plan › work › review › done`을 따라가고, 지금 단계는 개수와 함께 밝게 켜집니다. 예를 들어 `/start-work`가 저장된 계획을 처리하는 동안에는 `WORK 3/7`처럼 보입니다. lit-loop 목표는 기준과 반복 횟수를 세고, litresearch 실행은 `decompose`에서 `wave`를 거쳐 `synthesis`까지 자기 단계를 따릅니다. 입력창 옆 칩은 지금 단계 앞뒤를, 사이드바는 같은 지도를 위에서 아래로 그리며 다음 단계로 넘어갈 때 선이 차오릅니다. 도구가 도는 동안에는 `⠹ bash · 0:48`처럼 도구 이름과 걸린 시간이 함께 보입니다. 긴 작업 중에 자리를 비운다면 같은 `tui.json` 항목에 `{ "notify": true }`를 주세요. OpenCode 자체 설정 `"attention": { "enabled": true }`도 켜 두면, 미션이 끝날 때 데스크톱 알림과 소리로 알려 줍니다. 직접 넣기 전에는 꺼져 있습니다.

카드는 기본으로 켜져 있습니다. 화면 아래를 비워 두고 싶다면 OpenCode `tui.json`의 LitOpenCode 항목에 `{ "band": false }` 옵션을 주세요. 더 자세히 보고 싶을 때는 `{ "band": { "card": true } }`를 주면 목표, 다음 할 일, 경고를 담은 카드가 하나 더 아래에 붙습니다. 카드의 각 부분은 [레퍼런스](./docs/reference-Ko-KR.md#tui-미션-패널)에 자세히 있습니다.

## 자동 인수인계

대화가 길어지면 모델의 컨텍스트 창이 차고, 넘친 내용은 잊힙니다. 자동 인수인계는 그렇게 되기 전에 지금 자리를 저장해 둡니다. 직접 켜기 전까지는 꺼져 있고, 몇 퍼센트에서 시작할지도 직접 정합니다.

켜려면 `lit-handoff auto on 70`만 담은 메시지를 보내세요. 70 자리에는 원하는 숫자를 넣으면 되고, `/lit-handoff auto on 70`을 실행해도 같습니다. LitOpenCode가 바뀐 설정을 답하면 모델이 그 내용을 한두 문장으로 전해 줍니다. `lit-handoff auto status`는 지금 상태와 설정이 어디서 왔는지 알려 줍니다. `lit-handoff auto off`는 기능을 끄면서 숫자는 기억해 두기 때문에, 나중에 숫자 없이 `lit-handoff auto on`만 보내도 그 숫자로 다시 켜집니다.

<p align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="./docs/assets/readme/auto-handoff-settings-dark.webp" /><img src="./docs/assets/readme/auto-handoff-settings-light.webp" width="760" alt="OpenCode에서 보낸 채팅 메시지 세 개와 각각에 대한 LitOpenCode의 답. lit-handoff auto on 70: Auto-handoff is ON at 70%. When a conversation reaches 70% of the model's context window, LitOpenCode asks the model to save a handoff, compacts the conversation, and loads the handoff back. lit-handoff auto status: 같은 문장 뒤에 The switch comes from the saved setting and the percent from the saved setting과 litopencode doctor 안내가 붙는다. lit-handoff auto off: Auto-handoff is OFF. The last percent, 70%, is kept for the next time you switch it on." /></picture></p>

그때부터 LitOpenCode가 컨텍스트 창이 얼마나 찼는지 지켜봅니다. 대화가 정한 퍼센트에 닿고 진행 중인 차례가 끝나면, 인수인계를 써 달라는 짧은 메시지를 모델에게 보냅니다. 저장된 파일에는 그 메시지에 적힌 표시 줄이 들어 있어야 하므로, 예전에 남은 인수인계 파일은 인정되지 않습니다. 새 인수인계가 확인되면 플러그인이 직접 대화를 압축하고 알림으로 알려 준 뒤, 다음 차례에 그 인수인계의 앞부분을 모델 앞에 다시 놓습니다. `/compact`를 직접 입력할 일은 없습니다.

<p align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="./docs/assets/readme/auto-handoff-compact-dark.webp" /><img src="./docs/assets/readme/auto-handoff-compact-light.webp" width="760" alt="대화가 70%에 닿았을 때 LitOpenCode가 보내는 메시지: Automatic handoff: this conversation has reached about 70% of the context window. Write the handoff now. 인수인계 제목 바로 아래에 Auto-handoff marker: ses_2b9f1c7a4e 2026-10-12T17:05:00.000Z 줄을 넣고, 파일 경로를 밝히는 한 문장으로 답하라고 요청한다. 그 아래 LitOpenCode auto-handoff라는 제목의 알림에 Handoff saved. Compacting the conversation now.가 적혀 있다." /></picture></p>

저장된 인수인계가 없으면 대화는 그대로 두고 알림으로 알려 줍니다. OpenCode가 압축을 받아 주지 않으면 `/compact`를 직접 실행하라는 알림이 뜹니다.

퍼센트는 OpenCode가 스스로 압축하는 지점보다 낮게 고르세요. 인수인계가 먼저 돌 틈이 있어야 하기 때문입니다. LitOpenCode가 설치하는 한도에서는 OpenCode가 90%에서 압축하고, 고른 퍼센트가 그와 같거나 높으면 `litopencode doctor`가 경고합니다. 프로젝트 폴더에서 doctor를 실행하면 지금 설정과 그 출처도 보여 줍니다. 채팅으로 저장했든, 설정 파일에 적었든, OpenCode를 띄우는 환경에서 정했든 마찬가지입니다. 환경 변수로는 `LITOPENCODE_AUTO_HANDOFF=1`이 기능을 켜고, `LITOPENCODE_AUTO_HANDOFF_PERCENT`에는 1부터 99 사이의 정수를 넣으며, 환경 변수는 채팅으로 정한 설정보다 우선합니다.

<p align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="./docs/assets/readme/auto-handoff-doctor-dark.webp" /><img src="./docs/assets/readme/auto-handoff-doctor-light.webp" width="694" alt="LITOPENCODE_AUTO_HANDOFF=1 LITOPENCODE_AUTO_HANDOFF_PERCENT=70 litopencode doctor 결과를 jq로 걸러 autoHandoff 블록 일부만 보여 주는 터미널 창. enabled true, percent 70, sources의 enabled env와 percent env, host의 autoCompaction true와 compactionPercent 90, 그리고 빈 warnings 목록이 나온다." /></picture></p>

설정을 파일에 두고 싶다면 프로젝트의 `.litopencode/config.json`에, 모든 프로젝트에 적용하려면 `~/.config/opencode/litopencode.json`에 `autoHandoff` 블록을 넣으세요. 환경 변수와 채팅 설정이 모두 파일보다 먼저입니다.

```json
{ "autoHandoff": { "enabled": true, "percent": 70 } }
```

단계별 설명은 [사용 안내](./docs/guide-Ko-KR.md#자동-인수인계)에, 모든 설정과 디스크에 남는 내용은 [레퍼런스](./docs/reference-Ko-KR.md#자동-인수인계)에 있습니다.

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

### 준비물

Node.js와 npm, 그리고 모델 제공자에 로그인해 둔 OpenCode 1(1.18.29 이상)과 OpenCode 2 가운데 하나 또는 둘 다입니다. OpenAI 제공자로 새로 설치하면 계획과 검토는 GPT-6 Astra가, 만들기는 GPT-6 Luna가 맡습니다. 다른 모델은 설치 중에 고를 수 있습니다.

### 설치 확인

설치 직후나 무언가 이상할 때 `litopencode doctor`를 실행하세요. 플러그인과 스킬이 제대로 연결됐는지 알려 줍니다. 읽기만 하고 아무것도 바꾸지 않습니다.

```sh
npm exec --package @litfamily/litopencode@latest -- litopencode doctor
```

### 업데이트

LitOpenCode는 대화형으로 시작할 때와 install이나 doctor가 성공한 뒤에 새 버전을 확인합니다. 버전을 고정해 두고 업데이트 시점을 직접 정하고 싶다면 `--no-auto-update`를 붙이거나 `LITOPENCODE_NO_AUTO_UPDATE=1`을 설정하세요. 설치 명령을 다시 실행해도 업데이트되며, 손봐 둔 모델 경로 설정은 그대로 남습니다.

### 제거

OpenCode의 `opencode.jsonc`에서 `plugin` 배열의 `@litfamily/litopencode` 항목을 지우고 OpenCode를 다시 시작하세요. 전역으로 설치했다면 다음 명령도 실행합니다.

```sh
npm uninstall -g @litfamily/litopencode
```

복사된 명령과 스킬 파일을 정리하는 방법, 다시 쓸 생각이라면 남겨 둘 파일은 [제거 상세 안내](./docs/guide-Ko-KR.md#제거)에 있습니다.

## 더 알아보기

- [사용 안내](./docs/guide-Ko-KR.md): 설치 옵션, 첫 작업과 계획을 세우는 작업, 자동 인수인계, 안전과 업데이트, 문제 해결, 완전한 제거 방법
- [스킬과 명령](./docs/skills-Ko-KR.md): 모든 경로와 스킬을 그림과 함께 정리하고, 문서·발표자료·디자인·브라우저 안내까지 담았습니다.
- [화면 미리 보기](./docs/screens-Ko-KR.md): 설치 화면, 상태 점검, 알림, 계획 에이전트가 어떻게 보이는지와 22초짜리 영상
- [워크플로 상세 안내](./docs/reference-Ko-KR.md): 모델, 권한, host 연결, 명령, 검증 방법. 영어판 [English reference](./docs/reference.md)에는 전체 스킬 목록과 규칙 엔진까지 있습니다.
- [마이그레이션 안내](./docs/migration.md) · [Changelog](./CHANGELOG.md) · [개인정보와 네트워크 동작](./docs/privacy.md)
- [그림 자료와 라이선스](./docs/brand-Ko-KR.md) · [터미널 마크와 활성화 확인 문구](./docs/lit-mark.md)
- [출시 체크리스트](./docs/release-checklist.md): 메인테이너용입니다. 이 저장소에만 있고 npm 패키지에는 들어가지 않습니다.
- [LitFamily 허브](https://github.com/wjgoarxiv/litfamily): 같은 `lit` 워크플로를 Claude Code, Codex CLI, Hermes Agent, Grok Build에서도 쓸 수 있습니다. 제품마다 따로 설치하고 따로 동작합니다.

## 기여와 라이선스

"어디까지 했더라?" 하며 보내던 아침을 LitOpenCode가 줄여 줬다면, GitHub 스타 하나가 다른 OpenCode 사용자가 이 프로젝트를 찾는 데 도움이 됩니다. 주변에 소개할 때는 이 한 줄이면 됩니다. OpenCode 프롬프트에 `lit`만 붙이면 내일 세션이 오늘 멈춘 자리에서 이어집니다.

버그 제보와 풀 리퀘스트를 환영합니다. [기여 안내](./CONTRIBUTING.md)부터 읽어 주시고, [지원](./SUPPORT.md), [보안 제보](./SECURITY.md), [행동 규범](./CODE_OF_CONDUCT.md)도 함께 확인해 주세요.

MIT입니다. [LICENSE](./LICENSE)를 보세요. `lit-handoff`와 `lit-scientific-visualization`에 함께 들어 있는 참조 원본은 `vendor/` 아래에 자체 라이선스·출처 파일과 함께 있습니다.

LitOpenCode 이름, 로고, 마스코트 그림은 [상표 정책](./TRADEMARK.md)을 따릅니다.

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
