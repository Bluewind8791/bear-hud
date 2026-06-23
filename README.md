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

| 파일 | 역할 |
|---|---|
| `statusline-merged.js` | 핵심 래퍼. 외부 npm 의존성 없음(Node 내장 모듈만). claude-hud 를 자식 프로세스로 실행해 출력을 재배치 |
| `setup.ps1` | `~/.claude/` 로 복사 + `settings.json` 의 `statusLine` 블록만 갱신 |

## 새 PC 설치

### 전제 조건
1. **Node 18+** (PATH에 `node`) — `winget install OpenJS.NodeJS.LTS`
2. **Git Bash** (PATH에 `bash`)
3. **claude-hud 플러그인** (런타임 의존성)
   ```
   /plugin marketplace add jarrodwatts/claude-hud
   /plugin install claude-hud
   /reload-plugins
   ```
   > ⚠️ claude-hud 의 `/claude-hud:setup` 은 **실행하지 말 것** — 그게 statusLine 을
   > claude-hud 본체로 덮어써 이 래퍼를 무력화함. 플러그인 설치까지만 하면 됨.

### 설치
```powershell
git clone <이 레포 URL> bluewind-statusline
cd bluewind-statusline
.\setup.ps1
```
Claude Code 재시작 → 적용.

## 동작 원리
- `setup.ps1` 이 쓰는 명령: `bash -c 'node "$HOME/.claude/statusline-merged.js"'`
  - 경로 하드코딩 없음: `$HOME` 은 bash 가, `node` 는 PATH 가 해석 → 머신 독립적
- 래퍼는 claude-hud 최신 버전을 `~/.claude/plugins/cache/claude-hud/` 에서 동적으로 탐색
  → 플러그인 업데이트돼도 경로 수정 불필요
- claude-hud 가 없으면 곰 마스코트만 표시(graceful fallback)

## 환경 변수 (선택)
- `BEAR_MOOD=react` — 한도 사용률에 곰 무드 연동 (기본: 랜덤)
