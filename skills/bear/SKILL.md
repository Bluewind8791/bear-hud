---
name: bear
description: bear-hud(곰 마스코트 + claude-hud) 상태표시줄을 이 PC 에 설정한다. 사용자가 /bear 를 입력했을 때 사용.
disable-model-invocation: true
---

# bear-hud 상태표시줄 설정

1. 실행한다: `node "${CLAUDE_PLUGIN_ROOT}/install.js"`
2. 종료 코드 0 이면 출력의 세 단계를 짧게 전한다. 상태표시줄은 다음 갱신부터 바뀐다. 바뀌지 않으면 Claude Code 를 재시작하라고 안내한다.
3. 종료 코드 2 면 다른 상태표시줄이 이미 설정돼 있는 것이다. 출력에 나온 현재 명령을 보여 주고, 곰 상태표시줄로 바꿀지 사용자에게 묻는다.
   - 승인하면 `node "${CLAUDE_PLUGIN_ROOT}/install.js" --replace` 를 실행한다. settings.json 은 바꾸기 전에 `settings.json.bak-bear-hud` 으로 백업된다.
   - 거절하면 아무것도 바꾸지 않는다.
4. 그 외 실패면 출력의 오류를 그대로 전한다. `node` 를 찾지 못하면 Node 18 이상 설치를 안내한다. Windows 는 상태표시줄을 Git Bash 로 실행하므로 Git Bash 도 필요하다.
