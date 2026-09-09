// 곰 마스코트(좌측 3줄) + claude-hud 출력을 "중복 없이 재배치"해 합치는 상태표시줄 래퍼.
//
// 레이아웃:
//         [모델 | 플랜] │ 프로젝트 git:(branch)     ← 1줄: 모델 badge + 프로젝트/git
//   곰1   💬 context XX%                            ← claude-hud identityLine(컨텍스트)
//   곰2   ⏳ session NN% (../5h)                    ← claude-hud usageLine 5h 세그먼트
//   곰3   📅 weekly NN% (../7d)                     ← claude-hud usageLine 7d 세그먼트
//   5줄+  (툴/에이전트/todo 등 claude-hud 활동 라인) ← 활동 있을 때만
//
// 동작: stdin 세션 JSON 을 받아 (1) 곰 무드 계산, (2) 같은 JSON 을 claude-hud 에
//       그대로 흘려보내 출력을 캡처, (3) 헤더를 💬(컨텍스트)/🔋(사용량) 아이콘 기준으로
//       분리해 곰 옆 1/2/3줄에 재배치한다. 자식으로 실행하면 stdout 이 TTY 가 아니라
//       claude-hud 의 줄바꿈(wrap)이 꺼져 헤더가 한 줄로 안정적으로 나온다.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

let input = '';
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', () => {
  let data = {};
  try {
    data = JSON.parse(input.replace(/^﻿/, '').trim());
  } catch {
    /* 파싱 실패해도 곰은 띄운다 */
  }

  const bear = buildBear(data);
  const hudPath = findHud();
  if (!hudPath) {
    printMerged(bear, [], data);
    return;
  }

  // COLUMNS 를 제거해 자식 claude-hud 의 줄바꿈(wrap)을 끈다 → 사용량(5h+7d)이
  // 항상 한 줄로 유지되어 7일치가 별도 줄로 밀려나지 않는다.
  const childEnv = { ...process.env };
  delete childEnv.COLUMNS;
  const child = spawn(process.execPath, [hudPath], {
    cwd: data.cwd && safeExists(data.cwd) ? data.cwd : process.cwd(),
    stdio: ['pipe', 'pipe', 'ignore'],
    env: childEnv,
  });
  let out = '';
  child.stdout.on('data', (c) => (out += c));
  child.on('error', () => printMerged(bear, [], data));
  child.on('close', () => {
    const lines = out.replace(/\r/g, '').split('\n').filter((l) => l.length > 0);
    printMerged(bear, lines, data);
  });
  child.stdin.on('error', () => {});
  child.stdin.write(input);
  child.stdin.end();
});

function safeExists(p) {
  try { return fs.existsSync(p); } catch { return false; }
}

// vendoring 한 claude-hud 의 dist/index.js 경로. setup.ps1 이 레포의
// vendor/claude-hud 를 ~/.claude/statusline-hud 로 복사한다. (업데이트는 수동 재복사)
function findHud() {
  const p = path.join(os.homedir(), '.claude', 'statusline-hud', 'dist', 'index.js');
  return safeExists(p) ? p : null;
}

// 곰 무드: bear 원본과 동일. 1분 버킷 + session_id 시드로 깜빡임 방지.
// BEAR_MOOD=react 시 한도 사용률에 무드 연동, 기본은 random.
function buildBear(data) {
  const GREEN = '\x1b[32m', YELLOW = '\x1b[33m', RED = '\x1b[31m',
    CYAN = '\x1b[36m', MAGENTA = '\x1b[35m', DIM = '\x1b[2m';
  const MOODS = [
    { eyes: '◕ᴥ◕', color: GREEN },        // 신남 ◕ᴥ◕
    { eyes: '≧ᴥ≦', color: GREEN },        // 행복 ≧ᴥ≦
    { eyes: '-ᴥ◕', color: MAGENTA },           // 윙크 -ᴥ◕
    { eyes: '•ᴥ•', color: '' },           // 평온 •ᴥ•
    { eyes: '-ᴥ-', color: DIM },                    // 졸림 -ᴥ-
    { eyes: '◉ᴥ◉', color: YELLOW },       // 깜짝 ◉ᴥ◉
    { eyes: '@ᴥ@', color: YELLOW },                 // 어지러움 @ᴥ@
    { eyes: '´•ᴥ•`', color: YELLOW },// 시무룩 ´•ᴥ•`
    { eyes: ';ᴥ;', color: CYAN },                   // 눈물 ;ᴥ;
    { eyes: 'òᴥó', color: RED },          // 심통 òᴥó
  ];
  const bucket = Math.floor(Date.now() / 60000);
  const seedStr = `${bucket}:${data.session_id || ''}`;
  let h = 0;
  for (const ch of seedStr) h = (h * 31 + ch.charCodeAt(0)) >>> 0;

  const react = (process.env.BEAR_MOOD || '').toLowerCase().startsWith('react');
  const usages = [data.rate_limits?.five_hour, data.rate_limits?.seven_day]
    .map((r) => (r && r.used_percentage != null ? r.used_percentage : null))
    .filter((v) => v != null);
  let mood;
  if (react && usages.length) {
    const max = Math.max(...usages);
    const band = max >= 90 ? [8, 9] : max >= 70 ? [7, 5, 6] : max >= 40 ? [3, 4] : [0, 1, 2];
    mood = MOODS[band[h % band.length]];
  } else {
    mood = MOODS[h % MOODS.length];
  }
  return {
    ears: ` ∩${'─'.repeat(mood.eyes.length + 2)}∩`, // ∩──∩
    face: `ʕ  ${mood.eyes}  ʔ`,                          // ʕ  eyes  ʔ
    body: ' (  u u  )',
    color: mood.color,
  };
}

function printMerged(bear, hudLines, data = {}) {
  const RESET = '\x1b[0m', DIM = '\x1b[2m';
  const COL = 13;
  const CTX_ICON = '\u{1F4AC}'; // 💬 claude-hud 컨텍스트(identityLine) 앵커
  const USE_ICON = '\u{1F50B}'; // 🔋 claude-hud 사용량(usageLine) 앵커
  const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
  const padCol = (s) => s + ' '.repeat(Math.max(0, COL - stripAnsi(s).length));
  const withBear = (art, info) => padCol(`${bear.color}${art}${RESET}`) + info;
  const bearOnly = (art) => `${bear.color}${art}${RESET}`;
  // 끝의 구분자(공백/NBSP/│/|)와 그 뒤에 붙은 ANSI 이스케이프를 함께 제거.
  const trimSep = (s) => s.replace(/(?:\x1b\[[0-9;]*m|[\s│|])+$/u, '');

  // claude-hud 헤더는 expanded 에서 `project | 💬context │ 🔋usage` 한 줄로 나온다
  // (구성요소가 빠지면 여러 줄로 나뉠 수도 있음). 아이콘이 등장하는 마지막 줄까지를
  // '헤더', 이후 줄을 '활동(툴/에이전트/todo)'으로 본다.
  const uLineIdx = hudLines.findIndex((l) => l.includes(USE_ICON));
  const cLineIdx = hudLines.findIndex((l) => l.includes(CTX_ICON));
  const headerEnd = Math.max(uLineIdx, cLineIdx, 0);
  const headerText = hudLines.slice(0, headerEnd + 1).join(' ');

  // 아이콘 앞의 dim(\x1b[2m) 이스케이프는 분리 과정에서 잘려나가므로, 잘라낸 뒤
  // 아이콘이 dim 으로 보이도록 DIM 을 다시 붙여 원본과 동일하게 만든다.
  const uIdx = headerText.indexOf(USE_ICON);
  let usage = uIdx >= 0 ? DIM + headerText.slice(uIdx) : '';
  const pre = uIdx >= 0 ? headerText.slice(0, uIdx) : headerText;
  const cIdx = pre.indexOf(CTX_ICON);
  const rawContext = cIdx >= 0 ? trimSep(pre.slice(cIdx)) : '';
  const project = trimSep(cIdx >= 0 ? pre.slice(0, cIdx) : pre);

  // 컨텍스트(💬) 줄: 막대를 제거하고 "session" 텍스트로 대체. 퍼센트는 claude-hud
  // 원래의 한도별 색(getContextColor)을 그대로 보존한다 → "💬 session 0%"(색 유지).
  // 단 첫 응답 전에는 퍼센트가 실측값이 아니므로(isContextUnknown 주석) 'idle' 로 대체한다.
  let coloredValue;
  if (isContextUnknown(data)) {
    coloredValue = `${DIM}idle${RESET}`;
  } else {
    const pctM = rawContext.match(/(\x1b\[[0-9;]*m)?(\d+%)/);
    coloredValue = pctM ? `${pctM[1] || ''}${pctM[2]}\x1b[0m` : '';
  }
  const context = rawContext ? `💬 context ${coloredValue}`.trimEnd() : '';

  // 사용량 줄을 session 과 weekly 로 분리.
  const { sessionStr, weeklyStr } = formatUsageSplit(usage);

  // 첫 줄의 모델 badge 와 프로젝트/git 을 분리(첫 `│` 기준) → 프로젝트는 4번째 줄로.
  let modelPart = project, projectPart = '';
  const sepIdx = project.indexOf('│');
  if (sepIdx >= 0) {
    modelPart = trimSep(project.slice(0, sepIdx));
    projectPart = project.slice(sepIdx + 1).replace(/^[\s│|]+/u, '');
  }
  // 모델 badge 의 컨텍스트 주석(예: " (1M context)") 제거 → "[Opus 4.8 | Max]"
  modelPart = modelPart.replace(/\s*\([^)]*\)(?=\s*[|\]])/g, '');

  // 레이아웃:
  //         [모델 | 플랜] │ 프로젝트 git:(branch)  ← 1줄: 모델 badge + 프로젝트
  //   곰1   💬 context XX%                         ← 2줄: 컨텍스트
  //   곰2   ⏳ session NN% (../5h)                 ← 3줄: session
  //   곰3   📅 weekly NN% (../7d)                  ← 4줄: weekly
  // 구분자 앞에 RESET 을 넣는다. claude-hud 의 모델 badge 는 끝에 리셋을 붙이지 않아
  // (trimSep 이 꼬리 이스케이프를 떼어낸다) 그대로 이으면 badge 의 색이 래퍼가 넣은
  // │ 까지 번진다. 구분자는 항상 기본색이어야 한다.
  const fourthLine = [modelPart, projectPart].filter(Boolean).join(RESET + ' │ ');
  if (fourthLine) console.log(fourthLine);
  console.log(context ? withBear(bear.ears, context) : bearOnly(bear.ears));
  console.log(sessionStr ? withBear(bear.face, sessionStr) : bearOnly(bear.face));
  console.log(weeklyStr ? withBear(bear.body, weeklyStr) : bearOnly(bear.body));
}

// 컨텍스트 사용량을 아직 알 수 없는 상태인지 판정한다.
//
// 세션이 막 시작돼 첫 API 응답이 오기 전에는 Claude Code 가 stdin 으로 주는
// context_window.used_percentage / current_usage 가 둘 다 없다. 이때 claude-hud 는
// 실측값 대신 autocompact 버퍼 상수(22.5%)를 퍼센트로 내보내므로, 모든 새 세션이
// 컨텍스트 크기·모델과 무관하게 항상 23% 로 시작한다(Math.round(22.5) === 23).
// 실제로 쓴 양이 아니라 상수이므로 퍼센트 대신 idle 로 표시한다.
//
// used_percentage 가 없어도 토큰이 잡히면(구버전 Claude Code 는 이 필드를 안 준다)
// claude-hud 의 수동 계산이 실측값이므로 그대로 퍼센트를 쓴다.
function isContextUnknown(data) {
  const cw = data.context_window;
  if (!cw) return true;
  const pct = cw.used_percentage;
  if (typeof pct === 'number' && !Number.isNaN(pct)) return false;
  const u = cw.current_usage || {};
  const tokens =
    (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
  return tokens === 0;
}

// 사용량 문자열(🔋 5h바 NN% (../5h) | 7d바 NN% (../7d))을
// session 과 weekly 로 분리해 반환: { sessionStr, weeklyStr }.
// ANSI 를 먼저 제거(코드 안 숫자 오인 방지)하고 막대(블록 U+2580~259F)·🔋 아이콘 제거.
function formatUsageSplit(usage) {
  // 세그먼트에서 막대·🔋 를 버리고 "색이 입혀진 퍼센트"부터 남긴다 → 한도별 색 보존.
  const fromPercent = (s) => {
    const idx = s.search(/(\x1b\[[0-9;]*m)?\d+%/);
    if (idx >= 0) return s.slice(idx).trim();
    return s.replace(/\x1b\[[0-9;]*m/g, '').replace(/[▀-▟]/g, '').replace(/🔋/g, '').trim();
  };
  const barIdx = usage.indexOf('|');
  if (barIdx < 0) {
    const one = fromPercent(usage);
    if (!one) return { sessionStr: '', weeklyStr: '' };
    // 퍼센트가 없으면 수치 대신 상태 문구(`⚠ (429)` 등)가 온 것이다. hud 는 이때
    // 세그먼트를 하나만 내보내므로 그대로 두면 weekly 줄이 통째로 빈칸이 된다.
    // 같은 문구를 두 줄에 모두 걸어 3줄 레이아웃을 유지한다.
    const status = !/\d+%/.test(usage);
    return {
      sessionStr: `⏳ session ${one}`,
      weeklyStr: status ? `📅 weekly ${one}` : '',
    };
  }
  const five = fromPercent(usage.slice(0, barIdx));
  const seven = fromPercent(usage.slice(barIdx + 1));
  return {
    sessionStr: five ? `⏳ session ${five}` : '',
    weeklyStr: seven ? `📅 weekly ${seven}` : '',
  };
}
