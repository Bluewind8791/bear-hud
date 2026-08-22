# bluewind-statusline

곰 마스코트(좌측 3줄) + [claude-hud](https://github.com/jarrodwatts/claude-hud) 출력을
재배치해 합치는 Claude Code 상태표시줄 래퍼.

```
        [모델 | 플랜] │ 프로젝트 git:(branch)
  ʕ◕ᴥ◕ʔ  💬 context XX%
   (u u)  ⏳ session NN% (../5h)
          📅 weekly NN% (../7d)
```

## 구성

| 경로 | 역할 |
|---|---|
| `statusline-merged.js` | 핵심 래퍼. 외부 npm 의존성 없음(Node 내장 모듈만). vendored HUD 를 자식 프로세스로 실행해 출력을 재배치 |
| `vendor/claude-hud/` | **claude-hud(MIT) vendoring 본**. `dist/`(런타임 .js만) + `LICENSE` + `package.json`(ESM 인식용). 플러그인 설치 불필요 |
| `setup.ps1` | **(Windows)** `~/.claude/` 로 래퍼 복사 + `vendor/claude-hud` → `~/.claude/statusline-hud` 복사 + `settings.json` 의 `statusLine` 블록만 갱신 + claude-hud `config.json` 의 `sevenDayThreshold` 갱신 |
| `setup.bat` | **(Windows)** `setup.ps1` 을 실행 정책 우회로 실행하는 더블클릭용 래퍼 |
| `setup.sh` | **(macOS / Linux)** `setup.ps1` 과 동일한 동작을 하는 셸 스크립트 (JSON 머지는 Node 로 처리) |

> claude-hud 는 MIT 라이선스라 vendoring 이 허용됩니다. `vendor/claude-hud/LICENSE` 로 고지를 포함합니다.

## 새 PC 설치

### 전제 조건

**Windows**
1. **Node 18+** (PATH에 `node`) — `winget install OpenJS.NodeJS.LTS`
2. **Git Bash** (PATH에 `bash`)

**macOS / Linux**
1. **Node 18+** (PATH에 `node`) — macOS: `brew install node`
2. `bash` — macOS/리눅스에 기본 포함

> claude-hud 플러그인 설치는 **불필요** — `vendor/` 에 포함돼 있음.

### 설치

공통으로 먼저 clone:
```
git clone https://github.com/Bluewind8791/bluewind-claude-statusline.git
cd bluewind-claude-statusline
```

**Windows** — 둘 중 하나:
- **간편 (더블클릭):** 탐색기에서 `setup.bat` 더블클릭
- **터미널:** `.\setup.ps1` (또는 `.\setup.bat`)

**macOS / Linux:**
```bash
./setup.sh
```

Claude Code 재시작 → 적용.

## 동작 원리
- 설치 스크립트(`setup.ps1` / `setup.sh`)가 쓰는 명령: `bash -c 'node "$HOME/.claude/statusline-merged.js"'`
  - 경로 하드코딩 없음: `$HOME` 은 bash 가, `node` 는 PATH 가 해석 → 머신 독립적
- 래퍼는 `~/.claude/statusline-hud/dist/index.js`(vendored HUD)를 실행
- HUD 가 없으면 곰 마스코트만 표시(graceful fallback)
- claude-hud 는 7일 사용률이 `sevenDayThreshold`(**기본 80**) 이상일 때만 7d 세그먼트를 렌더한다.
  그대로 두면 주간 사용률이 80% 를 넘기 전까지 `📅 weekly` 줄이 안 보이므로, 설치 스크립트가
  `~/.claude/plugins/claude-hud/config.json` 의 `display.sevenDayThreshold` 를 `0` 으로 맞춘다
  (파일이 이미 있으면 해당 키만 머지 — 나머지 설정 보존)
- 새 세션은 첫 API 응답이 오기 전까지 컨텍스트를 `💬 context idle` 로 표시한다. 이 시점엔
  Claude Code 가 `context_window.used_percentage` / `current_usage` 를 주지 않는데, claude-hud 가
  그 자리에 autocompact 버퍼 상수(22.5%)를 넣어 항상 `23%` 를 내보낸다 — 실측값이 아니라 상수라
  래퍼가 `idle` 로 갈아끼운다 (`isContextUnknown`)

## claude-hud 업데이트 (수동)
vendoring 이라 자동 업데이트가 안 됩니다. 최신 claude-hud 를 반영하려면:

1. 플러그인으로 최신본을 받거나(`/plugin install claude-hud`) GitHub 릴리스에서 `dist/` 확보
2. `vendor/claude-hud/dist/` 를 새 `dist/` 로 교체 (런타임 `.js` 만, `.map`/`.d.ts` 제외)
3. `vendor/claude-hud/package.json` 의 `version` 갱신
4. 커밋 → 각 PC 에서 pull 후 재설치 (Windows: `.\setup.ps1`, macOS/Linux: `./setup.sh`)

## 환경 변수 (선택)
- `BEAR_MOOD=react` — 한도 사용률에 곰 무드 연동 (기본: 랜덤)
