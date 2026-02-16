import { bulkUpsertGames, saveImportProgress, loadImportProgress, clearImportProgress, getLatestGameTimestampForProfile } from './db';
import { parsePGN } from './pgn';

const ARCHIVE_RE = /\/games\/(\d{4})\/(\d{2})$/;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const parseArchiveRange = (url) => {
    const match = url.match(ARCHIVE_RE);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (!year || !month) return null;
    const start = new Date(year, month - 1, 1).getTime();
    const end = new Date(year, month, 1).getTime();
    return { start, end };
};

const mapChessComGame = (game) => {
    if (!game?.pgn) return null;
    const parsed = parsePGN(game.pgn);
    if (!parsed) return null;

    const timestamp = typeof game.end_time === 'number'
        ? game.end_time * 1000
        : parsed.timestamp || Date.now();
    const date = parsed.date || new Date(timestamp).toISOString();

    const whiteName = parsed.white || game.white?.username || 'Unknown';
    const blackName = parsed.black || game.black?.username || 'Unknown';

    const speed = (game.time_class || parsed.perf || parsed.speed || 'standard').toLowerCase();
    const sourceGameId = game.uuid || game.url || `${timestamp}-${whiteName}-${blackName}`;

    return {
        ...parsed,
        white: whiteName,
        black: blackName,
        whiteRating: parsed.whiteRating ?? game.white?.rating ?? null,
        blackRating: parsed.blackRating ?? game.black?.rating ?? null,
        date,
        timestamp,
        perf: speed,
        speed,
        timeControl: parsed.timeControl || game.time_control || '',
        variant: (parsed.variant || game.rules || 'standard').toLowerCase(),
        rated: typeof game.rated === 'boolean' ? game.rated : parsed.rated ?? null,
        platform: 'chesscom',
        sourceGameId,
        sourceUrl: game.url || '',
        site: 'Chess.com',
        isHero: true,
        source: 'chesscom',
        importTag: 'hero',
        analyzed: false,
        analysisStatus: 'idle'
    };
};

const fetchJsonWithRetry = async (url, retries = 2, delay = 1000) => {
    try {
        const res = await fetch(url);
        if (!res.ok) {
            if (res.status === 429 && retries > 0) {
                await sleep(delay);
                return fetchJsonWithRetry(url, retries - 1, delay * 2);
            }
            throw new Error(`Chess.com API error: ${res.statusText}`);
        }
        return await res.json();
    } catch (err) {
        const isNetwork = err instanceof TypeError || `${err.message}`.toLowerCase().includes('network');
        if (retries > 0 && isNetwork) {
            await sleep(delay);
            return fetchJsonWithRetry(url, retries - 1, delay * 2);
        }
        throw err;
    }
};

export const fetchChessComUser = async (username) => {
    const profile = await fetchJsonWithRetry(`https://api.chess.com/pub/player/${username}`);
    let stats = null;
    try {
        stats = await fetchJsonWithRetry(`https://api.chess.com/pub/player/${username}/stats`);
    } catch {
        stats = null;
    }

    const sumRecord = (record) => {
        if (!record) return { win: 0, loss: 0, draw: 0 };
        return {
            win: record.win || 0,
            loss: record.loss || 0,
            draw: record.draw || 0
        };
    };

    const buckets = ['chess_blitz', 'chess_rapid', 'chess_bullet', 'chess_daily', 'chess960', 'chess_variant'];
    const totals = buckets.reduce((acc, key) => {
        const record = sumRecord(stats?.[key]?.record);
        acc.win += record.win;
        acc.loss += record.loss;
        acc.draw += record.draw;
        return acc;
    }, { win: 0, loss: 0, draw: 0 });

    return {
        username: profile.username || username,
        createdAt: profile.joined ? profile.joined * 1000 : null,
        avatar: profile.avatar || '',
        count: {
            win: totals.win,
            loss: totals.loss,
            draw: totals.draw,
            all: totals.win + totals.loss + totals.draw
        }
    };
};

export const hasChessComNewGames = async (username, since) => {
    if (!since) return false;
    const archivesData = await fetchJsonWithRetry(`https://api.chess.com/pub/player/${username}/games/archives`);
    const archives = Array.isArray(archivesData?.archives) ? archivesData.archives : [];
    const latestUrl = archives[archives.length - 1];
    if (!latestUrl) return false;
    const archive = await fetchJsonWithRetry(latestUrl);
    const games = Array.isArray(archive?.games) ? archive.games : [];
    return games.some((g) => (typeof g.end_time === 'number' ? g.end_time * 1000 : 0) > since);
};

export const syncChessComGames = async (username, onProgress, options = {}) => {
    const {
        mode = 'smart',
        since: optionsSince,
        until: optionsUntil,
        resumeFrom = null,
        signal = null
    } = options;

    const now = Date.now();
    let targetSince;
    let targetUntil;

    if (mode === 'smart') {
        const ninetyDaysAgo = now - (90 * 24 * 60 * 60 * 1000);
        const latestLocal = await getLatestGameTimestampForProfile('chesscom', username);
        targetSince = latestLocal > ninetyDaysAgo ? latestLocal + 1 : ninetyDaysAgo;
        targetUntil = now;
        onProgress({
            type: 'range-determined',
            message: latestLocal > ninetyDaysAgo
                ? `Quick import: fetching from ${new Date(targetSince).toLocaleDateString()} to today`
                : `Quick import: last 90 days`,
            since: targetSince,
            until: targetUntil,
            total: 0,
            percentage: 0
        });
    } else if (mode === 'custom') {
        targetSince = optionsSince;
        targetUntil = optionsUntil;
    } else {
        targetSince = 0;
        targetUntil = now;
    }

    const archivesData = await fetchJsonWithRetry(`https://api.chess.com/pub/player/${username}/games/archives`);
    const archives = Array.isArray(archivesData?.archives) ? archivesData.archives : [];

    const relevantArchives = archives.filter((url) => {
        const range = parseArchiveRange(url);
        if (!range) return true;
        return range.end >= targetSince && range.start <= targetUntil;
    });

    let startIndex = 0;
    let totalImported = 0;
    let failedChunks = [];

    if (resumeFrom) {
        startIndex = typeof resumeFrom.cursor === 'number' ? resumeFrom.cursor : 0;
        totalImported = resumeFrom.totalImported || 0;
        failedChunks = resumeFrom.failedChunks || [];
        onProgress({
            type: 'resume',
            message: `Resuming from archive ${startIndex + 1} of ${relevantArchives.length}...`,
            total: totalImported,
            percentage: relevantArchives.length ? (startIndex / relevantArchives.length) * 100 : 0
        });
    }

    onProgress({
        type: 'start',
        message: 'Starting import...',
        total: totalImported,
        percentage: 0
    });

    for (let i = startIndex; i < relevantArchives.length; i++) {
        if (signal?.aborted) {
            await saveImportProgress('chesscom', username, {
                currentSince: targetSince,
                targetUntil,
                totalImported,
                status: 'paused',
                mode,
                failedChunks,
                cursor: i
            });
            onProgress({
                type: 'cancelled',
                message: `Import cancelled. ${totalImported} games saved.`,
                total: totalImported,
                percentage: relevantArchives.length ? (i / relevantArchives.length) * 100 : 0
            });
            return { totalImported, failedChunks, success: false, cancelled: true };
        }

        const url = relevantArchives[i];
        onProgress({
            type: 'progress',
            message: `Fetching archive ${i + 1} of ${relevantArchives.length}...`,
            total: totalImported,
            percentage: relevantArchives.length ? (i / relevantArchives.length) * 100 : 0
        });

        try {
            const archive = await fetchJsonWithRetry(url);
            const rawGames = Array.isArray(archive?.games) ? archive.games : [];
            const filtered = rawGames.filter((g) => {
                const ts = typeof g.end_time === 'number' ? g.end_time * 1000 : null;
                if (!ts) return true;
                return ts >= targetSince && ts <= targetUntil;
            });
            const mappedGames = filtered.map(mapChessComGame).filter(Boolean);
            if (mappedGames.length) {
                await bulkUpsertGames(mappedGames);
                totalImported += mappedGames.length;
            }

            onProgress({
                type: 'chunk-complete',
                message: `Imported ${mappedGames.length} games`,
                count: mappedGames.length,
                total: totalImported,
                percentage: relevantArchives.length ? ((i + 1) / relevantArchives.length) * 100 : 100
            });

            await saveImportProgress('chesscom', username, {
                currentSince: targetSince,
                targetUntil,
                totalImported,
                status: 'in-progress',
                mode,
                failedChunks,
                cursor: i + 1
            });

            await sleep(350);
        } catch (err) {
            failedChunks.push({
                since: targetSince,
                until: targetUntil,
                error: err.message,
                timestamp: Date.now()
            });
            onProgress({
                type: 'chunk-error',
                message: `Failed archive ${i + 1}: ${err.message}`,
                error: err.message,
                total: totalImported,
                percentage: relevantArchives.length ? (i / relevantArchives.length) * 100 : 0
            });
        }
    }

    await clearImportProgress('chesscom', username);

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

export const loadChessComImportProgress = async (username) => {
    return await loadImportProgress('chesscom', username);
};
