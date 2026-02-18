import { bulkUpsertGames, getLatestGameTimestampForProfile, getDistinctGameDaysInRange, saveImportProgress, clearImportProgress } from './db';

const constructPgn = (game) => {
    const headers = [
        `[Event "${game.tournament || 'Casual'}"]`,
        `[Site "Lichess"]`,
        `[Date "${new Date(game.createdAt).toISOString().split('T')[0]}"]`,
        `[Time "${new Date(game.createdAt).toISOString().split('T')[1].substring(0, 8)}"]`,
        `[UTCDate "${new Date(game.createdAt).toISOString().split('T')[0].replace(/-/g, '.')}"]`,
        `[UTCTime "${new Date(game.createdAt).toISOString().split('T')[1].substring(0, 8)}"]`,
        `[White "${game.players?.white?.user?.name || game.players?.white?.name || 'Anonymous'}"]`,
        `[Black "${game.players?.black?.user?.name || game.players?.black?.name || 'Anonymous'}"]`,
        `[Result "${game.winner ? (game.winner === 'white' ? '1-0' : '0-1') : '1/2-1/2'}"]`,
        `[WhiteElo "${game.players?.white?.rating || '?'}"]`,
        `[BlackElo "${game.players?.black?.rating || '?'}"]`,
        `[Variant "${game.variant || 'Standard'}"]`,
        `[ECO "${game.opening?.eco || '?'}"]`,
        `[Opening "${game.opening?.name || '?'}"]`
    ].join('\n');
    return `${headers}\n\n${game.moves}`;
};

const mapLichessGame = (game) => {
    const pgn = game.pgn || constructPgn(game);
    const speed = game.speed || game.perf || 'standard';
    const timeControl = game.clock ? `${game.clock.initial}+${game.clock.increment}` : '';

    return {
        lichessId: game.id,
        platform: 'lichess',
        sourceGameId: game.id,
        sourceUrl: game.id ? `https://lichess.org/${game.id}` : '',
        site: 'Lichess',
        date: new Date(game.createdAt).toISOString(),
        white: game.players?.white?.user?.name || game.players?.white?.name || 'Anonymous',
        black: game.players?.black?.user?.name || game.players?.black?.name || 'Anonymous',
        whiteTitle: game.players?.white?.user?.title || '',
        blackTitle: game.players?.black?.user?.title || '',
        whiteRating: game.players?.white?.rating,
        blackRating: game.players?.black?.rating,
        perf: speed,
        speed,
        timeControl,
        result: game.winner ? (game.winner === 'white' ? '1-0' : '0-1') : '1/2-1/2',
        eco: game.opening?.eco || '',
        openingName: game.opening?.name || 'Unknown Opening',
        pgn: pgn,
        timestamp: game.createdAt,
        variant: game.variant || 'standard',
        rated: typeof game.rated === 'boolean' ? game.rated : null,
        tournament: game.tournament || '',
        isHero: true,
        source: 'lichess',
        importTag: 'hero',
        analyzed: false,
        analysisStatus: 'idle'
    };
};

// Proactive rate limiter to prevent hitting API limits
class RateLimiter {
    constructor(requestsPerMinute = 20) {
        this.requestsPerMinute = requestsPerMinute;
        this.minDelay = (60 * 1000) / requestsPerMinute; // milliseconds between requests
        this.lastRequest = 0;
    }

    async throttle() {
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequest;

        if (timeSinceLastRequest < this.minDelay) {
            const waitTime = this.minDelay - timeSinceLastRequest;
            await new Promise(r => setTimeout(r, waitTime));
        }

        this.lastRequest = Date.now();
    }
}

// Circuit breaker to prevent rapid-fire rate limit errors
class RateLimitCircuitBreaker {
    constructor() {
        this.failureCount = 0;
        this.lastFailure = 0;
        this.state = 'closed'; // 'closed', 'open', 'half-open'
        this.threshold = 3;
        this.cooldownMs = 120000; // 2 minutes
    }

    async execute(fn) {
        if (this.state === 'open') {
            if (Date.now() - this.lastFailure > this.cooldownMs) {
                this.state = 'half-open';
            } else {
                throw new Error('Too many rate limit errors. Please wait 2 minutes before retrying.');
            }
        }

        try {
            const result = await fn();
            if (this.state === 'half-open') {
                this.reset();
            }
            return result;
        } catch (err) {
            if (err.message.includes('Rate Limit') || err.message.includes('429')) {
                this.recordFailure();
            }
            throw err;
        }
    }

    recordFailure() {
        this.failureCount++;
        this.lastFailure = Date.now();
        if (this.failureCount >= this.threshold) {
            this.state = 'open';
        }
    }

    reset() {
        this.failureCount = 0;
        this.state = 'closed';
    }
}

export const fetchLichessGames = async (username, max = 50, filters = {}) => {
    const params = new URLSearchParams({
        max: max.toString(),
        clocks: 'false',
        opening: 'true',
        evals: 'false',
        pgnInJson: 'true',
    });

    if (filters.since) params.append('since', filters.since.toString());
    if (filters.until) params.append('until', filters.until.toString());
    if (filters.perfType) params.append('perfType', filters.perfType);
    const signal = filters.signal || null;

    const sleepWithAbort = (ms) => new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException('Aborted', 'AbortError'));
            return;
        }
        const t = setTimeout(() => {
            if (signal?.aborted) {
                reject(new DOMException('Aborted', 'AbortError'));
                return;
            }
            resolve();
        }, ms);
        if (signal) {
            const onAbort = () => {
                clearTimeout(t);
                reject(new DOMException('Aborted', 'AbortError'));
            };
            signal.addEventListener('abort', onAbort, { once: true });
        }
    });

    const makeRequest = async (retries = 3, delay = 1000) => {
        try {
            if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
            const response = await fetch(`https://lichess.org/api/games/user/${username}?${params.toString()}`, {
                headers: {
                    'Accept': 'application/x-ndjson',
                },
                signal
            });

            if (!response.ok) {
                if (response.status === 429) {
                    // Lichess 429 often requires a full minute wait if IP banned, 
                    // but for shorter bursts 30-60s might be needed.
                    // We'll increment delay significantly.
                    const waitTime = delay * 2;
                    console.warn(`Rate limit hit (429). Waiting ${waitTime}ms before retry...`);

                    if (retries > 0) {
                        await sleepWithAbort(waitTime);
                        return makeRequest(retries - 1, waitTime);
                    }
                    throw new Error('Lichess Rate Limit hit. Please wait a minute and try again.');
                }
                throw new Error(`Lichess API error: ${response.statusText}`);
            }
            return response;
        } catch (err) {
            if (err?.name === 'AbortError') throw err;
            // Retry on network errors (TypeErrors) or specific messages
            const isNetworkError = err instanceof TypeError ||
                err.message.toLowerCase().includes('network') ||
                err.message.toLowerCase().includes('fetch');

            if (retries > 0 && isNetworkError) {
                console.warn(`Network error details: ${err.message}. Retrying in ${delay}ms...`);
                await sleepWithAbort(delay);
                return makeRequest(retries - 1, delay * 2);
            }
            throw err;
        }
    };

    const response = await makeRequest();

    if (!response.body) throw new Error('No response body');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const games = [];

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();

            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const game = JSON.parse(line);
                    games.push(game);
                } catch (e) {
                    console.error('Failed to parse game JSON line:', line, e);
                }
            }
        }
        // Handle last chunk
        if (buffer.trim()) {
            try {
                const game = JSON.parse(buffer);
                games.push(game);
            } catch (e) { }
        }
    } catch (err) {
        console.error("Stream reading error", err);
        throw err;
    }

    return games;
};

// Get smart default import range — last 7 days
export const getDefaultImportRange = (username) => {
    const now = Date.now();
    const last7Days = now - (7 * 24 * 60 * 60 * 1000);
    return {
        since: last7Days,
        until: now,
        reason: 'last-7-days'
    };
};

export const syncUserGames = async (username, onProgress, options = {}) => {
    const {
        mode = 'smart',
        since: optionsSince,
        until: optionsUntil,
        resumeFrom = null,
        signal = null // AbortController signal for cancellation
    } = options;

    const now = Date.now();
    let targetSince, targetUntil;
    const safePercent = (value) => {
        if (!Number.isFinite(value)) return 0;
        return Math.max(0, Math.min(100, value));
    };

    // Determine date range based on mode
    if (mode === 'smart') {
        const sevenDaysAgo = now - (7 * 24 * 60 * 60 * 1000);
        const latestLocal = await getLatestGameTimestampForProfile('lichess', username);
        // Start from whichever is more recent: 7 days ago or right after our latest local game
        // This avoids re-fetching days we already have
        targetSince = latestLocal > sevenDaysAgo ? latestLocal + 1 : sevenDaysAgo;
        targetUntil = now;
        onProgress({
            type: 'range-determined',
            message: latestLocal > sevenDaysAgo
                ? `Quick import: fetching from ${new Date(targetSince).toLocaleDateString()} to today`
                : `Quick import: last 7 days`,
            since: targetSince,
            until: targetUntil,
            total: 0,
            percentage: 0
        });
    } else if (mode === 'custom') {
        targetSince = optionsSince;
        targetUntil = optionsUntil;
    } else if (mode === 'full') {
        // Fetch entire history from account creation — per-chunk skip handles already-synced ranges
        targetSince = options.startTime || 0;
        targetUntil = now;
    }

    // Check for resumable import
    let currentSince = targetSince;
    let totalImported = 0;
    let failedChunks = [];

    if (resumeFrom) {
        currentSince = resumeFrom.currentSince;
        if (typeof resumeFrom.targetSince === 'number') targetSince = resumeFrom.targetSince;
        if (typeof resumeFrom.targetUntil === 'number') targetUntil = resumeFrom.targetUntil;
        if (typeof targetSince === 'number' && typeof currentSince === 'number' && currentSince < targetSince) {
            targetSince = currentSince;
        }
        totalImported = resumeFrom.totalImported || 0;
        failedChunks = resumeFrom.failedChunks || [];
        const denom = targetUntil - targetSince;
        onProgress({
            type: 'resume',
            message: `Resuming from ${new Date(currentSince).toLocaleDateString()}... (${totalImported} already imported)`,
            total: totalImported,
            percentage: safePercent(denom > 0 ? ((currentSince - targetSince) / denom) * 100 : 0)
        });
    }

    // Use fixed 7-day chunks (simple and reliable)
    // We check for "distinct active days" to skip fully synced weeks
    const CHUNK_MS = 7 * 24 * 60 * 60 * 1000;

    onProgress({
        type: 'start',
        message: `Starting import...`,
        total: totalImported,
        percentage: 0
    });

    // Initialize rate limiter and circuit breaker
    const rateLimiter = new RateLimiter(20);
    const circuitBreaker = new RateLimitCircuitBreaker();

    // Main sync loop
    while (currentSince < targetUntil) {
        // Yield to event loop to keep UI responsive (essential for cancel button)
        await new Promise(resolve => setTimeout(resolve, 0));

        // Check for cancellation
        if (signal?.aborted) {
            await saveImportProgress('lichess', username, {
                targetSince,
                currentSince,
                targetUntil,
                totalImported,
                status: 'paused',
                mode,
                failedChunks
            });
            onProgress({
                type: 'cancelled',
                message: `Import cancelled. ${totalImported} games saved.`,
                total: totalImported,
                percentage: safePercent((targetUntil - targetSince) > 0 ? ((currentSince - targetSince) / (targetUntil - targetSince)) * 100 : 0)
            });
            return { totalImported, failedChunks, success: false, cancelled: true };
        }

        const currentUntil = Math.min(currentSince + CHUNK_MS, targetUntil);
        const dateFromStr = new Date(currentSince).toLocaleDateString();
        const dateToStr = new Date(currentUntil).toLocaleDateString();
        const pct = safePercent((targetUntil - targetSince) > 0 ? ((currentSince - targetSince) / (targetUntil - targetSince)) * 100 : 0);

        onProgress({
            type: 'progress',
            message: `Checking ${dateFromStr} to ${dateToStr}...`,
            total: totalImported,
            percentage: pct
        });

        try {
            // Check if we already have games for this date range locally
            // Heuristic: If we have games for >= 5 distinct days in a 7-day chunk, assume it's fully synced.
            // If < 5 days, fetch the whole chunk to fill any potential gaps (safe due to upsert).
            const chunkIncludesToday = currentUntil >= now;
            const distinctDays = await getDistinctGameDaysInRange('lichess', username, currentSince, currentUntil);
            const isHeuristicallyFull = distinctDays >= 5;

            if (isHeuristicallyFull && !chunkIncludesToday) {
                // Skip this chunk — likely already synced
                const skipPct = safePercent((targetUntil - targetSince) > 0 ? ((currentUntil - targetSince) / (targetUntil - targetSince)) * 100 : 0);
                onProgress({
                    type: 'chunk-complete',
                    message: `Skipped ${dateFromStr} – ${dateToStr} (${distinctDays} active days found locally)`,
                    count: 0,
                    total: totalImported,
                    percentage: skipPct
                });
                currentSince = currentUntil;
                continue;
            }

            await rateLimiter.throttle();

            await circuitBreaker.execute(async () => {
                const rawGames = await fetchLichessGames(username, 1000, {
                    since: currentSince,
                    until: currentUntil,
                    signal
                });

                if (rawGames.length > 0) {
                    const mappedGames = rawGames.map(mapLichessGame);
                    await bulkUpsertGames(mappedGames);
                    totalImported += mappedGames.length;
                }

                const newPct = safePercent((targetUntil - targetSince) > 0 ? ((currentUntil - targetSince) / (targetUntil - targetSince)) * 100 : 0);
                onProgress({
                    type: 'chunk-complete',
                    message: `Imported ${rawGames.length} games (${dateFromStr} – ${dateToStr})`,
                    count: rawGames.length,
                    total: totalImported,
                    percentage: newPct
                });
            });

            // Save progress after each successful chunk
            await saveImportProgress('lichess', username, {
                targetSince,
                currentSince: currentUntil,
                targetUntil,
                totalImported,
                status: 'in-progress',
                mode,
                failedChunks
            });

        } catch (err) {
            if (err?.name === 'AbortError' || signal?.aborted) {
                await saveImportProgress('lichess', username, {
                    targetSince,
                    currentSince,
                    targetUntil,
                    totalImported,
                    status: 'paused',
                    mode,
                    failedChunks
                });
                onProgress({
                    type: 'cancelled',
                    message: `Import cancelled. ${totalImported} games saved.`,
                    total: totalImported,
                    percentage: safePercent((targetUntil - targetSince) > 0 ? ((currentSince - targetSince) / (targetUntil - targetSince)) * 100 : 0)
                });
                return { totalImported, failedChunks, success: false, cancelled: true };
            }
            console.error(`Chunk failed (${dateFromStr} - ${dateToStr}):`, err);

            failedChunks.push({
                since: currentSince,
                until: currentUntil,
                error: err.message,
                timestamp: Date.now()
            });

            onProgress({
                type: 'chunk-error',
                message: `Failed: ${dateFromStr} - ${dateToStr} (${err.message})`,
                error: err.message,
                total: totalImported,
                percentage: safePercent((targetUntil - targetSince) > 0 ? ((currentSince - targetSince) / (targetUntil - targetSince)) * 100 : 0)
            });

            if (err.message.includes('Too many rate limit errors')) {
                await saveImportProgress('lichess', username, {
                    targetSince,
                    currentSince,
                    targetUntil,
                    totalImported,
                    status: 'paused',
                    mode,
                    failedChunks
                });

                onProgress({
                    type: 'paused',
                    message: `Rate limited. ${totalImported} games saved. Resume in 2 minutes.`,
                    total: totalImported,
                    percentage: safePercent((targetUntil - targetSince) > 0 ? ((currentSince - targetSince) / (targetUntil - targetSince)) * 100 : 0)
                });

                throw err;
            }
        }

        currentSince = currentUntil;
    }

    // Import complete
    await clearImportProgress('lichess', username);

    onProgress({
        type: 'success',
        message: `Import complete! ${totalImported} games imported.`,
        total: totalImported,
        percentage: 100
    });

    return {
        totalImported,
        failedChunks,
        success: failedChunks.length === 0
    };
};

export const fetchLichessUser = async (username) => {
    const response = await fetch(`https://lichess.org/api/user/${username}`);
    if (!response.ok) {
        if (response.status === 404) throw new Error('User not found');
        throw new Error(`Lichess API error: ${response.statusText}`);
    }
    return await response.json();
};
