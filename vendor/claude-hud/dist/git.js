import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);
// GIT_NO_LAZY_FETCH: a partial clone fetches missing objects on its own, through the repo's own transport config.
function gitEnv() {
    return { ...process.env, GIT_NO_LAZY_FETCH: '1' };
}
/**
 * A repository's own config is as untrusted as its files, and git runs commands it names
 * (ported from claude-hud 0.11.1/0.15.0: GHSA-fq7j-8hxj-jfqh, GHSA-f7gq-pcm8-rxr4, GHSA-25hg-g83m-4w35):
 *   - core.fsmonitor, which runs on every status
 *   - filter drivers, which run whenever git hashes a changed file. Drivers from the user's
 *     global or system config keep working (git-lfs). A repo driver whose name isn't plain
 *     ([\w.-]) can't be named back in `-c`, so this throws and git isn't run.
 *   - the network: protocol.allow=never (and GIT_NO_LAZY_FETCH) so a partial clone's lazy fetch
 *     can't reach the repo's transport config
 * Callers also pass --ignore-submodules=dirty, since git inside a submodule reads its config.
 */
async function untrustedConfigOverrides(cwd) {
    const overrides = ['-c', 'core.fsmonitor=false', '-c', 'protocol.allow=never'];
    let listed;
    try {
        ({ stdout: listed } = await execFileAsync('git', ['config', '--show-scope', '-z', '--get-regexp', '^filter\\.'], { cwd, timeout: 1000, encoding: 'utf8', env: gitEnv() }));
    }
    catch {
        return overrides; // exits 1 when no filter is configured
    }
    const drivers = new Set();
    const fields = listed.split('\0');
    for (let i = 0; i + 1 < fields.length; i += 2) {
        const [scope, entry] = [fields[i], fields[i + 1]];
        if (scope === 'global' || scope === 'system')
            continue;
        const key = entry.split('\n', 1)[0];
        const name = key.slice('filter.'.length, key.lastIndexOf('.'));
        if (!/^[\w.-]+$/.test(name))
            throw new Error('a repo filter driver git could not be told to skip');
        drivers.add(name);
    }
    for (const name of drivers) {
        overrides.push('-c', `filter.${name}.clean=`, '-c', `filter.${name}.process=`, '-c', `filter.${name}.required=false`);
    }
    return overrides;
}
export async function getGitBranch(cwd) {
    if (!cwd)
        return null;
    try {
        const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, timeout: 1000, encoding: 'utf8', env: gitEnv() });
        return stdout.trim() || null;
    }
    catch {
        return null;
    }
}
export async function getGitStatus(cwd) {
    if (!cwd)
        return null;
    try {
        // Get branch name
        const { stdout: branchOut } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, timeout: 1000, encoding: 'utf8', env: gitEnv() });
        const branch = branchOut.trim();
        if (!branch)
            return null;
        // Throws (skipping git info, as upstream does) for a repo filter that can't be switched off
        const safe = await untrustedConfigOverrides(cwd);
        // Check for dirty state and parse file stats
        let isDirty = false;
        let fileStats;
        try {
            const { stdout: statusOut } = await execFileAsync('git', ['--no-optional-locks', ...safe, 'status', '--porcelain', '--ignore-submodules=dirty'], { cwd, timeout: 1000, encoding: 'utf8', env: gitEnv() });
            const trimmed = statusOut.trim();
            isDirty = trimmed.length > 0;
            if (isDirty) {
                fileStats = parseFileStats(trimmed);
            }
        }
        catch {
            // Ignore errors, assume clean
        }
        // Get ahead/behind counts
        let ahead = 0;
        let behind = 0;
        try {
            const { stdout: revOut } = await execFileAsync('git', [...safe, 'rev-list', '--left-right', '--count', '@{upstream}...HEAD'], { cwd, timeout: 1000, encoding: 'utf8', env: gitEnv() });
            const parts = revOut.trim().split(/\s+/);
            if (parts.length === 2) {
                behind = parseInt(parts[0], 10) || 0;
                ahead = parseInt(parts[1], 10) || 0;
            }
        }
        catch {
            // No upstream or error, keep 0/0
        }
        return { branch, isDirty, ahead, behind, fileStats };
    }
    catch {
        return null;
    }
}
/**
 * Parse git status --porcelain output and count file stats (Starship-compatible format)
 * Status codes: M=modified, A=added, D=deleted, ??=untracked
 */
function parseFileStats(porcelainOutput) {
    const stats = { modified: 0, added: 0, deleted: 0, untracked: 0 };
    const lines = porcelainOutput.split('\n').filter(Boolean);
    for (const line of lines) {
        if (line.length < 2)
            continue;
        const index = line[0]; // staged status
        const worktree = line[1]; // unstaged status
        if (line.startsWith('??')) {
            stats.untracked++;
        }
        else if (index === 'A') {
            stats.added++;
        }
        else if (index === 'D' || worktree === 'D') {
            stats.deleted++;
        }
        else if (index === 'M' || worktree === 'M' || index === 'R' || index === 'C') {
            // M=modified, R=renamed (counts as modified), C=copied (counts as modified)
            stats.modified++;
        }
    }
    return stats;
}
//# sourceMappingURL=git.js.map