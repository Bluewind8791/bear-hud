import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as http from 'http';
import * as https from 'https';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { createDebug } from './debug.js';
import { getClaudeConfigDir, getHudPluginDir } from './claude-config-dir.js';
const debug = createDebug('usage');
const LEGACY_KEYCHAIN_SERVICE_NAME = 'Claude Code-credentials';
// File-based cache (HUD runs as new process each render, so in-memory cache won't persist)
const CACHE_TTL_MS = 60_000; // 60 seconds
const CACHE_FAILURE_TTL_MS = 15_000; // 15 seconds for failed requests
const RATE_LIMIT_BACKOFF_MS = 5 * 60_000; // 429 에 Retry-After(초)가 없을 때 쉬는 시간
const KEYCHAIN_TIMEOUT_MS = 3000;
const KEYCHAIN_BACKOFF_MS = 60_000; // Backoff on keychain failures to avoid re-prompting
function getCachePath(homeDir) {
    return path.join(getHudPluginDir(homeDir), '.usage-cache.json');
}
function readCache(homeDir, now, source) {
    try {
        const cachePath = getCachePath(homeDir);
        if (!fs.existsSync(cachePath))
            return null;
        const content = fs.readFileSync(cachePath, 'utf8');
        const cache = JSON.parse(content);
        // Proxied and direct sessions share this file but report different
        // accounts, so a differing source is a miss rather than a stale hit.
        if (cache.source !== source)
            return null;
        // Check TTL - use shorter TTL for failure results
        const ttl = cache.data.apiUnavailable ? CACHE_FAILURE_TTL_MS : CACHE_TTL_MS;
        // 429 를 받았으면 서버가 정한 시각까지는 TTL 이 지나도 다시 부르지 않는다.
        // 15초마다 두드리면 429 가 풀리지 않고 계속 이어진다.
        if (now - cache.timestamp >= ttl && !(cache.data.retryUntil > now))
            return null;
        // JSON.stringify converts Date to ISO string, so we need to reconvert on read.
        // new Date() handles both Date objects and ISO strings safely.
        const data = cache.data;
        if (data.fiveHourResetAt) {
            data.fiveHourResetAt = new Date(data.fiveHourResetAt);
        }
        if (data.sevenDayResetAt) {
            data.sevenDayResetAt = new Date(data.sevenDayResetAt);
        }
        return data;
    }
    catch {
        return null;
    }
}
function writeCache(homeDir, data, timestamp, source) {
    try {
        const cachePath = getCachePath(homeDir);
        const cacheDir = path.dirname(cachePath);
        if (!fs.existsSync(cacheDir)) {
            fs.mkdirSync(cacheDir, { recursive: true });
        }
        const cache = { data, timestamp, source };
        fs.writeFileSync(cachePath, JSON.stringify(cache), 'utf8');
    }
    catch {
        // Ignore cache write failures
    }
}
// 마지막으로 캐시에 들어간 수치를 TTL 과 무관하게 읽는다. 실패 응답도 직전 수치를
// 싣고 저장되므로 조회가 계속 막혀도 값이 이어진다. 단 리셋 시각이 지난 창은 이미
// 0 으로 돌아갔으니 버린다 - 옛날 수치를 현재값인 척 보여주지 않기 위해서다.
function readPreviousUsage(homeDir, source, now) {
    try {
        const cachePath = getCachePath(homeDir);
        if (!fs.existsSync(cachePath))
            return null;
        const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
        if (cache.source !== source || !cache.data)
            return null;
        const alive = (value, resetAt) => {
            if (value == null || !resetAt)
                return { value: null, resetAt: null };
            const at = new Date(resetAt);
            if (isNaN(at.getTime()) || at.getTime() <= now)
                return { value: null, resetAt: null };
            return { value, resetAt: at };
        };
        const five = alive(cache.data.fiveHour, cache.data.fiveHourResetAt);
        const seven = alive(cache.data.sevenDay, cache.data.sevenDayResetAt);
        if (five.value === null && seven.value === null)
            return null;
        return {
            fiveHour: five.value,
            sevenDay: seven.value,
            fiveHourResetAt: five.resetAt,
            sevenDayResetAt: seven.resetAt,
        };
    }
    catch {
        return null;
    }
}
const defaultDeps = {
    homeDir: () => os.homedir(),
    fetchApi: fetchUsageApi,
    now: () => Date.now(),
    readKeychain: readKeychainCredentials,
    resolveEndpoint: () => resolveLocalEndpoint(process.env),
    rateLimits: undefined,
};
/**
 * Get OAuth usage data from Anthropic API.
 * Returns null if user is an API user (no OAuth credentials) or credentials are expired.
 * Returns { apiUnavailable: true, ... } if API call fails (to show warning in HUD).
 *
 * Uses file-based cache since HUD runs as a new process each render (~300ms).
 * Cache TTL: 60s for success, 15s for failures.
 */
export async function getUsage(overrides = {}) {
    const deps = { ...defaultDeps, ...overrides };
    const now = deps.now();
    const homeDir = deps.homeDir();
    const endpoint = deps.resolveEndpoint();
    const source = endpointSource(endpoint);
    // Claude Code 가 stdin 으로 넘겨준 rate_limits 가 있으면 API 를 부르지 않고 그 값을
    // 쓴다. 응답 헤더에서 받은 이 세션의 실제 수치라 캐시보다 앞선다. 캐시에도 적어
    // 두어 아직 값이 없는 다른 세션(첫 응답 전)이 API 대신 이걸 읽게 한다.
    const fromStdin = usageFromRateLimits(deps.rateLimits);
    if (fromStdin) {
        try {
            const credentials = readCredentials(homeDir, now, deps.readKeychain);
            const planName = credentials ? getPlanName(credentials.subscriptionType) : null;
            if (!planName)
                return null;
            const result = { planName, ...fromStdin };
            writeCache(homeDir, result, now, source);
            return result;
        }
        catch (error) {
            debug('stdin rate_limits failed:', error);
        }
    }
    // Check file-based cache first
    const cached = readCache(homeDir, now, source);
    if (cached) {
        return cached;
    }
    try {
        const credentials = readCredentials(homeDir, now, deps.readKeychain);
        if (!credentials) {
            return null;
        }
        const { accessToken, subscriptionType } = credentials;
        // Determine plan name from subscriptionType
        const planName = getPlanName(subscriptionType);
        if (!planName) {
            // API user, no usage limits to show
            return null;
        }
        // Fetch usage from API
        const apiResult = await deps.fetchApi(accessToken, endpoint);
        if (!apiResult.data) {
            // API call failed, cache the failure to prevent retry storms.
            // 직전에 읽어 둔 수치는 실어 보낸다. 조회가 막혔을 뿐 사용량이 사라진 게
            // 아니므로, 렌더러가 ⚠ 를 붙여 "마지막으로 본 값"으로 보여준다.
            const previous = readPreviousUsage(homeDir, source, now);
            const failureResult = {
                planName,
                fiveHour: previous?.fiveHour ?? null,
                sevenDay: previous?.sevenDay ?? null,
                fiveHourResetAt: previous?.fiveHourResetAt ?? null,
                sevenDayResetAt: previous?.sevenDayResetAt ?? null,
                apiUnavailable: true,
                apiError: apiResult.error,
                retryUntil: apiResult.retryAfterMs ? now + apiResult.retryAfterMs : undefined,
            };
            writeCache(homeDir, failureResult, now, source);
            return failureResult;
        }
        // Parse response - API returns 0-100 percentage directly
        // Clamp to 0-100 and handle NaN/Infinity
        const fiveHour = parseUtilization(apiResult.data.five_hour?.utilization);
        const sevenDay = parseUtilization(apiResult.data.seven_day?.utilization);
        const fiveHourResetAt = parseDate(apiResult.data.five_hour?.resets_at);
        const sevenDayResetAt = parseDate(apiResult.data.seven_day?.resets_at);
        const result = {
            planName,
            fiveHour,
            sevenDay,
            fiveHourResetAt,
            sevenDayResetAt,
        };
        // Write to file cache
        writeCache(homeDir, result, now, source);
        return result;
    }
    catch (error) {
        debug('getUsage failed:', error);
        return null;
    }
}
/**
 * Get path for keychain failure backoff cache.
 * Separate from usage cache to track keychain-specific failures.
 */
function getKeychainBackoffPath(homeDir) {
    return path.join(getHudPluginDir(homeDir), '.keychain-backoff');
}
/**
 * Check if we're in keychain backoff period (recent failure/timeout).
 * Prevents re-prompting user on every render cycle.
 */
function isKeychainBackoff(homeDir, now) {
    try {
        const backoffPath = getKeychainBackoffPath(homeDir);
        if (!fs.existsSync(backoffPath))
            return false;
        const timestamp = parseInt(fs.readFileSync(backoffPath, 'utf8'), 10);
        return now - timestamp < KEYCHAIN_BACKOFF_MS;
    }
    catch {
        return false;
    }
}
/**
 * Record keychain failure for backoff.
 */
function recordKeychainFailure(homeDir, now) {
    try {
        const backoffPath = getKeychainBackoffPath(homeDir);
        const dir = path.dirname(backoffPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(backoffPath, String(now), 'utf8');
    }
    catch {
        // Ignore write failures
    }
}
/**
 * Determine the macOS Keychain service name for Claude Code credentials.
 * Claude Code uses the default service for ~/.claude and a hashed suffix for custom config directories.
 */
export function getKeychainServiceName(configDir, homeDir) {
    const normalizedConfigDir = path.normalize(path.resolve(configDir));
    const normalizedDefaultDir = path.normalize(path.resolve(path.join(homeDir, '.claude')));
    if (normalizedConfigDir === normalizedDefaultDir) {
        return LEGACY_KEYCHAIN_SERVICE_NAME;
    }
    const hash = createHash('sha256').update(normalizedConfigDir).digest('hex').slice(0, 8);
    return `${LEGACY_KEYCHAIN_SERVICE_NAME}-${hash}`;
}
export function getKeychainServiceNames(configDir, homeDir, env = process.env) {
    const serviceNames = [getKeychainServiceName(configDir, homeDir)];
    const envConfigDir = env.CLAUDE_CONFIG_DIR?.trim();
    if (envConfigDir) {
        const normalizedDefaultDir = path.normalize(path.resolve(path.join(homeDir, '.claude')));
        const normalizedEnvDir = path.normalize(path.resolve(envConfigDir));
        if (normalizedEnvDir === normalizedDefaultDir) {
            serviceNames.push(LEGACY_KEYCHAIN_SERVICE_NAME);
        }
        else {
            const envHash = createHash('sha256').update(envConfigDir).digest('hex').slice(0, 8);
            serviceNames.push(`${LEGACY_KEYCHAIN_SERVICE_NAME}-${envHash}`);
        }
    }
    serviceNames.push(LEGACY_KEYCHAIN_SERVICE_NAME);
    return [...new Set(serviceNames)];
}
function isMissingKeychainItemError(error) {
    if (!error || typeof error !== 'object')
        return false;
    const maybeError = error;
    if (maybeError.status === 44)
        return true;
    const message = typeof maybeError.message === 'string' ? maybeError.message.toLowerCase() : '';
    if (message.includes('could not be found in the keychain'))
        return true;
    const stderr = typeof maybeError.stderr === 'string'
        ? maybeError.stderr.toLowerCase()
        : Buffer.isBuffer(maybeError.stderr)
            ? maybeError.stderr.toString('utf8').toLowerCase()
            : '';
    return stderr.includes('could not be found in the keychain');
}
export function resolveKeychainCredentials(serviceNames, now, loadService) {
    let shouldBackoff = false;
    for (const serviceName of serviceNames) {
        try {
            const keychainData = loadService(serviceName).trim();
            if (!keychainData)
                continue;
            const data = JSON.parse(keychainData);
            const credentials = parseCredentialsData(data, now);
            if (credentials) {
                return { credentials, shouldBackoff: false };
            }
        }
        catch (error) {
            if (!isMissingKeychainItemError(error)) {
                shouldBackoff = true;
            }
        }
    }
    return { credentials: null, shouldBackoff };
}
/**
 * Read credentials from macOS Keychain.
 * Claude Code stores OAuth credentials in the macOS Keychain with profile-specific service names.
 * Returns null if not on macOS or credentials not found.
 *
 * Security: Uses execFileSync with absolute path to avoid shell injection and PATH hijacking.
 */
function readKeychainCredentials(now, homeDir) {
    // Only available on macOS
    if (process.platform !== 'darwin') {
        return null;
    }
    // Check backoff to avoid re-prompting on every render after a failure
    if (isKeychainBackoff(homeDir, now)) {
        debug('Keychain in backoff period, skipping');
        return null;
    }
    try {
        const configDir = getClaudeConfigDir(homeDir);
        const serviceNames = getKeychainServiceNames(configDir, homeDir);
        debug('Trying keychain service names:', serviceNames);
        const resolved = resolveKeychainCredentials(serviceNames, now, (serviceName) => execFileSync('/usr/bin/security', ['find-generic-password', '-s', serviceName, '-w'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: KEYCHAIN_TIMEOUT_MS }));
        if (resolved.credentials) {
            return resolved.credentials;
        }
        if (resolved.shouldBackoff) {
            recordKeychainFailure(homeDir, now);
        }
        return null;
    }
    catch (error) {
        // Security: Only log error message, not full error object (may contain stdout/stderr with tokens)
        const message = error instanceof Error ? error.message : 'unknown error';
        debug('Failed to read from macOS Keychain:', message);
        // Record failure for backoff to avoid re-prompting
        recordKeychainFailure(homeDir, now);
        return null;
    }
}
/**
 * Read credentials from file (legacy method).
 * Older versions of Claude Code stored credentials in {CLAUDE_CONFIG_DIR}/.credentials.json.
 */
function readFileCredentials(homeDir, now) {
    const credentialsPath = path.join(getClaudeConfigDir(homeDir), '.credentials.json');
    if (!fs.existsSync(credentialsPath)) {
        return null;
    }
    try {
        const content = fs.readFileSync(credentialsPath, 'utf8');
        const data = JSON.parse(content);
        return parseCredentialsData(data, now);
    }
    catch (error) {
        debug('Failed to read credentials file:', error);
        return null;
    }
}
/**
 * Parse and validate credentials data from either Keychain or file.
 */
function parseCredentialsData(data, now) {
    const accessToken = data.claudeAiOauth?.accessToken;
    const subscriptionType = data.claudeAiOauth?.subscriptionType ?? '';
    if (!accessToken) {
        return null;
    }
    // Check if token is expired (expiresAt is Unix ms timestamp)
    // Use != null to handle expiresAt=0 correctly (would be expired)
    const expiresAt = data.claudeAiOauth?.expiresAt;
    if (expiresAt != null && expiresAt <= now) {
        debug('OAuth token expired');
        return null;
    }
    return { accessToken, subscriptionType };
}
/**
 * Read OAuth credentials, trying macOS Keychain first (Claude Code 2.x),
 * then falling back to file-based credentials (older versions).
 *
 * Token priority: Keychain token is authoritative (Claude Code 2.x stores current token there).
 * SubscriptionType: Can be supplemented from file if keychain lacks it (display-only field).
 */
function readCredentials(homeDir, now, readKeychain) {
    // Try macOS Keychain first (Claude Code 2.x)
    const keychainCreds = readKeychain(now, homeDir);
    if (keychainCreds) {
        if (keychainCreds.subscriptionType) {
            debug('Using credentials from macOS Keychain');
            return keychainCreds;
        }
        // Keychain has token but no subscriptionType - try to supplement from file
        const fileCreds = readFileCredentials(homeDir, now);
        if (fileCreds?.subscriptionType) {
            debug('Using keychain token with file subscriptionType');
            return {
                accessToken: keychainCreds.accessToken,
                subscriptionType: fileCreds.subscriptionType,
            };
        }
        // No subscriptionType available - use keychain token anyway
        debug('Using keychain token without subscriptionType');
        return keychainCreds;
    }
    // Fall back to file-based credentials (older versions or non-macOS)
    const fileCreds = readFileCredentials(homeDir, now);
    if (fileCreds) {
        debug('Using credentials from file');
        return fileCreds;
    }
    return null;
}
function getPlanName(subscriptionType) {
    const lower = subscriptionType.toLowerCase();
    if (lower.includes('max'))
        return 'Max';
    if (lower.includes('pro'))
        return 'Pro';
    if (lower.includes('team'))
        return 'Team';
    // API users don't have subscriptionType or have 'api'
    if (!subscriptionType || lower.includes('api'))
        return null;
    // Unknown subscription type - show it capitalized
    return subscriptionType.charAt(0).toUpperCase() + subscriptionType.slice(1);
}
/** Parse utilization value, clamping to 0-100 and handling NaN/Infinity */
function parseUtilization(value) {
    if (value == null)
        return null;
    if (!Number.isFinite(value))
        return null; // Handles NaN and Infinity
    return Math.round(Math.max(0, Math.min(100, value)));
}
/** stdin 의 rate_limits 를 usageData 꼴로 바꾼다. 두 창 다 없으면 null */
function usageFromRateLimits(rateLimits) {
    const fiveHour = parseUtilization(rateLimits?.five_hour?.used_percentage);
    const sevenDay = parseUtilization(rateLimits?.seven_day?.used_percentage);
    if (fiveHour === null && sevenDay === null)
        return null;
    return {
        fiveHour,
        sevenDay,
        fiveHourResetAt: parseEpochSeconds(rateLimits.five_hour?.resets_at),
        sevenDayResetAt: parseEpochSeconds(rateLimits.seven_day?.resets_at),
    };
}
/** resets_at 은 Unix epoch 초 단위다 */
function parseEpochSeconds(value) {
    if (!Number.isFinite(value))
        return null;
    return new Date(value * 1000);
}
/** Retry-After 를 ms 로. 초 단위가 아니거나(HTTP-date) 없으면 기본 백오프 */
function parseRetryAfter(value) {
    const seconds = Number(value);
    return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : RATE_LIMIT_BACKOFF_MS;
}
/** Parse ISO date string safely, returning null for invalid dates */
function parseDate(dateStr) {
    if (!dateStr)
        return null;
    const date = new Date(dateStr);
    // Check for Invalid Date
    if (isNaN(date.getTime())) {
        debug('Invalid date string:', dateStr);
        return null;
    }
    return date;
}
const LOOPBACK_HOSTNAMES = new Set(['localhost', '::1']);
/** Whether a URL hostname refers to this machine. */
function isLoopbackHost(hostname) {
    if (!hostname)
        return false;
    const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (LOOPBACK_HOSTNAMES.has(host))
        return true;
    return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}
/**
 * A local Anthropic-API endpoint this session was pointed at, or null.
 *
 * Multi-account proxies (teamclaude and the like) launch Claude Code with
 * ANTHROPIC_BASE_URL or HTTPS_PROXY aimed at a loopback port and rotate the
 * account per request. The credentials file still holds whichever account
 * ran the login, so asking api.anthropic.com directly reports a DIFFERENT
 * account than the one this session is spending. The local endpoint knows
 * the active one.
 *
 * Loopback only: a corporate HTTPS_PROXY is not an Anthropic API.
 */
export function resolveLocalEndpoint(env = process.env) {
    const candidates = [
        env.ANTHROPIC_BASE_URL,
        env.HTTPS_PROXY, env.https_proxy, env.HTTP_PROXY, env.http_proxy,
    ];
    for (const raw of candidates) {
        if (!raw)
            continue;
        let url;
        try {
            url = new URL(raw);
        }
        catch {
            continue;
        }
        if (!isLoopbackHost(url.hostname))
            continue;
        return {
            hostname: url.hostname.replace(/^\[|\]$/g, ''),
            port: Number(url.port) || (url.protocol === 'https:' ? 443 : 80),
            basePath: url.pathname.replace(/\/+$/, ''),
        };
    }
    return null;
}
/** Cache key identifying where the numbers came from. */
function endpointSource(endpoint) {
    return endpoint ? `local:${endpoint.hostname}:${endpoint.port}${endpoint.basePath}` : 'direct';
}
function requestUsage(endpoint, accessToken) {
    return new Promise((resolve) => {
        const headers = {
            'anthropic-beta': 'oauth-2025-04-20',
            'User-Agent': 'claude-hud/1.0',
        };
        // A rotating proxy injects the active account's token upstream;
        // sending ours would report the login account instead.
        if (!endpoint)
            headers['Authorization'] = `Bearer ${accessToken}`;
        const options = endpoint
            ? {
                hostname: endpoint.hostname,
                port: endpoint.port,
                path: `${endpoint.basePath}/api/oauth/usage`,
                method: 'GET',
                headers,
                timeout: 5000,
            }
            : {
                hostname: 'api.anthropic.com',
                path: '/api/oauth/usage',
                method: 'GET',
                headers,
                timeout: 5000,
            };
        const req = (endpoint ? http : https).request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk.toString();
            });
            res.on('end', () => {
                if (res.statusCode !== 200) {
                    debug('API returned non-200 status:', res.statusCode);
                    resolve({
                        data: null,
                        error: res.statusCode ? `http-${res.statusCode}` : 'http-error',
                        retryAfterMs: res.statusCode === 429 ? parseRetryAfter(res.headers['retry-after']) : null,
                    });
                    return;
                }
                try {
                    const parsed = JSON.parse(data);
                    // Something unrelated may be on that loopback port.
                    if (endpoint && parsed?.five_hour == null && parsed?.seven_day == null) {
                        resolve({ data: null, error: 'shape' });
                        return;
                    }
                    resolve({ data: parsed });
                }
                catch (error) {
                    debug('Failed to parse API response:', error);
                    resolve({ data: null, error: 'parse' });
                }
            });
        });
        req.on('error', (error) => {
            debug('API request error:', error);
            resolve({ data: null, error: 'network' });
        });
        req.on('timeout', () => {
            debug('API request timeout');
            req.destroy();
            resolve({ data: null, error: 'timeout' });
        });
        req.end();
    });
}
/**
 * Ask the local endpoint first when this session has one, falling back to
 * api.anthropic.com on any failure so a stopped proxy never blanks the HUD.
 */
async function fetchUsageApi(accessToken, endpoint = null) {
    if (endpoint) {
        const local = await requestUsage(endpoint, accessToken);
        if (local.data)
            return local;
        debug('Local endpoint failed, falling back to api.anthropic.com:', local.error);
    }
    return requestUsage(null, accessToken);
}
// Export for testing
export function clearCache(homeDir) {
    if (homeDir) {
        try {
            const cachePath = getCachePath(homeDir);
            if (fs.existsSync(cachePath)) {
                fs.unlinkSync(cachePath);
            }
        }
        catch {
            // Ignore
        }
    }
}
//# sourceMappingURL=usage-api.js.map