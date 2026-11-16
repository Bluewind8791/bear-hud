// 플러그인 설치본의 statusLine 이 실행하는 launcher.
//
// /bear(install.js)가 이 파일을 버전과 무관한 고정 위치(~/.claude/bear-hud/)에
// 복사하고, statusLine 이 `node <이 파일> <플러그인 폴더>` 를 실행하게 한다.
//
// 플러그인 cache 는 버전마다 폴더가 다르고(<플러그인 폴더>/<version>/), 업데이트되면
// 이전 버전 폴더에 .orphaned_at 이 붙었다가 14일 뒤 지워진다. 그래서 statusLine 에 버전
// 폴더를 박지 않고, 실행할 때마다 현재 버전 폴더를 찾아 그 안의 래퍼를 실행한다.
const fs = require('fs');
const path = require('path');

function currentVersionDir(pluginDir) {
  let dirs;
  try {
    dirs = fs.readdirSync(pluginDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => path.join(pluginDir, d.name))
      .filter((d) => fs.existsSync(path.join(d, 'statusline-merged.js')));
  } catch {
    return null;
  }
  const live = dirs.filter((d) => !fs.existsSync(path.join(d, '.orphaned_at')));
  const pool = live.length > 0 ? live : dirs;
  pool.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return pool[0] || null;
}

const dir = process.argv[2] && currentVersionDir(process.argv[2]);
if (dir) require(path.join(dir, 'statusline-merged.js'));
