// 플러그인 설치본의 설정 스크립트. /bear 스킬이 `node "${CLAUDE_PLUGIN_ROOT}/install.js"` 로 실행한다.
//
// 동작:
//   1) launcher.js 를 버전과 무관한 고정 위치(~/.claude/bear-hud/)에 복사한다
//   2) ~/.claude/settings.json 의 statusLine 이 그 launcher 를 실행하게 한다(나머지 설정 보존)
//   3) claude-hud config 의 sevenDayThreshold 를 0 으로 (📅 weekly 항상 표시)
//
// statusLine 에 이 레포가 아닌 다른 명령이 이미 있으면 바꾸지 않고 종료 코드 2 로 끝난다.
// 사용자 확인을 받은 뒤 --replace 로 다시 실행하면 settings.json 을 백업하고 바꾼다.
const fs = require('fs');
const os = require('os');
const path = require('path');

const replace = process.argv.includes('--replace');
const claudeDir = path.join(os.homedir(), '.claude');
const settingsPath = path.join(claudeDir, 'settings.json');
const pluginDir = path.dirname(__dirname); // __dirname 은 cache 의 <플러그인 폴더>/<version>
const launcherDir = path.join(claudeDir, 'bear-hud');
const launcherPath = path.join(launcherDir, 'launcher.js');

// statusLine 은 bash 가 실행하므로(Windows 는 Git Bash) 경로를 / 로 바꾼다.
const slash = (p) => p.replace(/\\/g, '/');
const command = `bash -c 'node "${slash(launcherPath)}" "${slash(pluginDir)}"'`;

function readJson(p) {
  if (!fs.existsSync(p)) return {};
  return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, ''));
}

// 1) settings.json 을 먼저 읽는다. 깨진 파일을 {} 로 덮어쓰면 다른 설정이 사라지므로 중단.
let settings;
try {
  settings = readJson(settingsPath);
} catch (e) {
  console.error(`settings.json 을 읽지 못해 중단: ${settingsPath}\n${e.message}`);
  process.exit(1);
}

const existing = typeof settings.statusLine?.command === 'string' ? settings.statusLine.command : '';
// clone 설치본(statusline-merged.js)이나 예전 launcher 는 이 레포 것이므로 묻지 않고 바꾼다.
const ours = /statusline-merged\.js|bear-hud/.test(existing);
if (existing && !ours && !replace) {
  console.error(`다른 상태표시줄이 이미 설정돼 있음: ${existing}`);
  process.exit(2);
}

// 2) launcher 복사
fs.mkdirSync(launcherDir, { recursive: true });
fs.copyFileSync(path.join(__dirname, 'launcher.js'), launcherPath);
console.log(`[1/3] launcher 복사: ${launcherPath}`);

// 3) statusLine 갱신
if (existing && !ours) {
  const backup = `${settingsPath}.bak-bear-hud`;
  fs.copyFileSync(settingsPath, backup);
  console.log(`      기존 settings.json 백업: ${backup}`);
}
settings.statusLine = { type: 'command', command };
fs.mkdirSync(claudeDir, { recursive: true });
fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
console.log(`[2/3] settings.json statusLine 갱신: ${command}`);

// 4) claude-hud config 의 sevenDayThreshold 만 머지 (setup.ps1 / setup.sh 와 같은 이유)
const hudDir = path.join(claudeDir, 'plugins', 'claude-hud');
const hudPath = path.join(hudDir, 'config.json');
let cfg;
try {
  cfg = readJson(hudPath);
} catch {
  cfg = {};
}
if (typeof cfg.display !== 'object' || cfg.display === null) cfg.display = {};
cfg.display.sevenDayThreshold = 0;
fs.mkdirSync(hudDir, { recursive: true });
fs.writeFileSync(hudPath, JSON.stringify(cfg, null, 2) + '\n');
console.log('[3/3] claude-hud config 갱신 (weekly 항상 표시)');
