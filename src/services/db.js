import Dexie from 'dexie';

export const db = new Dexie('ChesslyzeDB');

db.version(1).stores({
    games: '++id, site, date, white, black, result, eco, [white+result], [black+result], timestamp',
    positions: 'fen, eval, classification, bestMove',
    openings: 'eco, name, winRate, frequency',
    analysis_queue: '++id, gameId, priority, status',
});

db.version(2).stores({
    games: '++id, site, date, white, black, result, eco, [white+result], [black+result], timestamp, analyzed',
});

db.version(3).stores({
    games: '++id, site, date, white, black, result, eco, openingName, [white+result], [black+result], timestamp, analyzed', // Added openingName
    openings: 'eco, name, winRate, frequency',
});

db.version(5).stores({
    positions: null // Drop table to allow primary key change
});

db.version(6).stores({
    games: '++id, lichessId, site, date, white, black, result, eco, openingName, [white+result], [black+result], timestamp, analyzed, analysisStatus',
    positions: '++id, gameId, fen, eval, classification, bestMove', // Recreate with new PK and index
    openings: 'eco, name, winRate, frequency',
}).upgrade(tx => {
    // Version 6 migration logic if needed
});

db.version(7).stores({
    games: '++id, lichessId, site, date, white, black, result, eco, openingName, [white+result], [black+result], timestamp, analyzed, analysisStatus',
    positions: '++id, gameId, fen, eval, classification, bestMove',
    openings: 'eco, name, winRate, frequency',
}).upgrade(tx => {
    // Stop auto-analysis: Convert all 'pending' to 'idle'
    return tx.table('games').where('analysisStatus').equals('pending').modify({ analysisStatus: 'idle' });
});

db.version(8).stores({
    games: '++id, lichessId, site, date, white, black, result, eco, openingName, [white+result], [black+result], timestamp, analyzed, analysisStatus, whiteRating, blackRating, perf', // Added metadata
    positions: '++id, gameId, fen, eval, classification, bestMove',
    openings: 'eco, name, winRate, frequency',
});

db.version(9).stores({
    games: '++id, lichessId, site, date, white, black, result, eco, openingName, [white+result], [black+result], timestamp, analyzed, analysisStatus, whiteRating, blackRating, perf, speed, timeControl, analyzedAt',
    positions: '++id, gameId, fen, eval, classification, bestMove, phase, tags, questionType, nextReviewAt',
    openings: 'eco, name, winRate, frequency',
}).upgrade(tx => {
    return tx.table('games').toCollection().modify((game) => {
        if (!game.analysisStatus) game.analysisStatus = 'idle';
    });
});

db.version(10).stores({
    games: '++id, lichessId, site, date, white, black, result, eco, openingName, [white+result], [black+result], timestamp, analyzed, analysisStatus, whiteRating, blackRating, perf, speed, timeControl, analyzedAt',
    positions: '++id, gameId, fen, eval, classification, bestMove, phase, tags, questionType, nextReviewAt',
    openings: 'eco, name, winRate, frequency, masterMoves',
});

db.version(11).stores({
    games: '++id, lichessId, site, date, white, black, result, eco, openingName, [white+result], [black+result], timestamp, analyzed, analysisStatus, analysisStartedAt, whiteRating, blackRating, perf, speed, timeControl, analyzedAt',
    positions: '++id, gameId, fen, eval, classification, bestMove, phase, tags, questionType, nextReviewAt',
    openings: 'eco, name, winRate, frequency, masterMoves',
});

db.version(12).stores({
    games: '++id, lichessId, site, date, white, black, result, eco, openingName, [white+result], [black+result], timestamp, analyzed, analysisStatus, analysisStartedAt, whiteRating, blackRating, perf, speed, timeControl, analyzedAt, priority',
    positions: '++id, gameId, fen, eval, classification, bestMove, phase, tags, questionType, nextReviewAt',
    openings: 'eco, name, winRate, frequency, masterMoves',
}).upgrade(tx => {
    return tx.table('games').toCollection().modify(g => {
        if (typeof g.priority === 'undefined') g.priority = 0;
    });
});

db.version(13).stores({
    games: '++id, lichessId, site, date, white, black, result, eco, openingName, [white+result], [black+result], timestamp, analyzed, analysisStatus, analysisStartedAt, whiteRating, blackRating, perf, speed, timeControl, analyzedAt, priority',
    positions: '++id, gameId, fen, eval, classification, bestMove, phase, tags, questionType, nextReviewAt',
    openings: 'eco, name, winRate, frequency, masterMoves',
    ai_analyses: '++id, gameId, promptVersion, createdAt'
});

db.version(14).stores({
    games: '++id, lichessId, site, date, white, black, result, eco, openingName, [white+result], [black+result], timestamp, analyzed, analysisStatus, analysisStartedAt, whiteRating, blackRating, perf, speed, timeControl, analyzedAt, priority, rated, variant',
    positions: '++id, gameId, fen, eval, classification, bestMove, phase, tags, questionType, nextReviewAt',
    openings: 'eco, name, winRate, frequency, masterMoves',
    ai_analyses: '++id, gameId, promptVersion, createdAt'
}).upgrade((tx) => {
    return tx.table('games').toCollection().modify((g) => {
        if (typeof g.rated === 'undefined') g.rated = null;
        if (!g.variant) g.variant = 'standard';
    });
});

db.version(15).stores({
    games: '++id, lichessId, site, date, white, black, result, eco, openingName, [white+result], [black+result], timestamp, analyzed, analysisStatus, analysisStartedAt, whiteRating, blackRating, perf, speed, timeControl, analyzedAt, priority, rated, variant, whiteTitle, blackTitle',
    positions: '++id, gameId, fen, eval, classification, bestMove, phase, tags, questionType, nextReviewAt',
    openings: 'eco, name, winRate, frequency, masterMoves',
    ai_analyses: '++id, gameId, promptVersion, createdAt'
}).upgrade((tx) => {
    return tx.table('games').toCollection().modify((g) => {
        if (!g.whiteTitle) g.whiteTitle = '';
        if (!g.blackTitle) g.blackTitle = '';
    });
});

db.version(16).stores({
    games: '++id, lichessId, pgnHash, site, date, white, black, result, eco, openingName, [white+result], [black+result], timestamp, analyzed, analysisStatus, analysisStartedAt, whiteRating, blackRating, perf, speed, timeControl, analyzedAt, priority, rated, variant, whiteTitle, blackTitle, isHero, source, importTag',
    positions: '++id, gameId, fen, eval, classification, bestMove, phase, tags, questionType, nextReviewAt',
    openings: 'eco, name, winRate, frequency, masterMoves',
    ai_analyses: '++id, gameId, promptVersion, createdAt'
}).upgrade((tx) => {
    return tx.table('games').toCollection().modify((g) => {
        if (typeof g.isHero !== 'boolean') g.isHero = true;
        if (!g.source) g.source = g.lichessId ? 'lichess' : 'pgn';
        if (!g.importTag) g.importTag = '';
        if (!g.pgnHash) g.pgnHash = '';
    });
});

db.version(17).stores({
    games: '++id, lichessId, pgnHash, site, date, white, black, result, eco, openingName, [white+result], [black+result], timestamp, analyzed, analysisStatus, analysisStartedAt, whiteRating, blackRating, perf, speed, timeControl, analyzedAt, priority, rated, variant, whiteTitle, blackTitle, isHero, source, importTag',
    positions: '++id, gameId, fen, eval, classification, bestMove, phase, tags, questionType, nextReviewAt',
    openings: 'eco, name, winRate, frequency, masterMoves',
    ai_analyses: '++id, gameId, promptVersion, createdAt',
    importProgress: 'username, currentSince, targetUntil, totalImported, lastUpdated, status, mode, failedChunks'
});

db.version(18).stores({
    games: '++id, lichessId, pgnHash, site, date, white, black, result, eco, openingName, [white+result], [black+result], timestamp, analyzed, analysisStatus, analysisStartedAt, whiteRating, blackRating, perf, speed, timeControl, analyzedAt, priority, rated, variant, whiteTitle, blackTitle, isHero, source, importTag, platform, sourceGameId, sourceUrl, &[platform+sourceGameId]',
    positions: '++id, gameId, fen, eval, classification, bestMove, phase, tags, questionType, nextReviewAt',
    openings: 'eco, name, winRate, frequency, masterMoves',
    ai_analyses: '++id, gameId, promptVersion, createdAt',
    importProgress: 'username, [platform+usernameLower], platform, usernameLower, currentSince, targetUntil, totalImported, lastUpdated, status, mode, failedChunks, cursor',
    heroProfiles: '++id, &[platform+usernameLower], platform, usernameLower, displayName, createdAt'
}).upgrade((tx) => {
    return tx.table('games').toCollection().modify((g) => {
        if (!g.platform) {
            if (g.source) {
                g.platform = g.source;
            } else if (g.lichessId) {
                g.platform = 'lichess';
            } else if (g.pgnHash) {
                g.platform = 'pgn';
            } else {
                g.platform = 'unknown';
            }
        }
        if (!g.sourceGameId) {
            if (g.platform === 'lichess' && g.lichessId) g.sourceGameId = g.lichessId;
            if (g.platform === 'pgn' && g.pgnHash) g.sourceGameId = g.pgnHash;
        }
        if (typeof g.sourceUrl !== 'string') g.sourceUrl = '';
    });
});

// Safety migration: drop importProgress if a previous schema changed its primary key.
db.version(19).stores({
    games: '++id, lichessId, pgnHash, site, date, white, black, result, eco, openingName, [white+result], [black+result], timestamp, analyzed, analysisStatus, analysisStartedAt, whiteRating, blackRating, perf, speed, timeControl, analyzedAt, priority, rated, variant, whiteTitle, blackTitle, isHero, source, importTag, platform, sourceGameId, sourceUrl, &[platform+sourceGameId]',
    positions: '++id, gameId, fen, eval, classification, bestMove, phase, tags, questionType, nextReviewAt',
    openings: 'eco, name, winRate, frequency, masterMoves',
    ai_analyses: '++id, gameId, promptVersion, createdAt',
    importProgress: null,
    heroProfiles: '++id, &[platform+usernameLower], platform, usernameLower, displayName, createdAt'
});

db.version(20).stores({
    games: '++id, lichessId, pgnHash, site, date, white, black, result, eco, openingName, [white+result], [black+result], timestamp, analyzed, analysisStatus, analysisStartedAt, whiteRating, blackRating, perf, speed, timeControl, analyzedAt, priority, rated, variant, whiteTitle, blackTitle, isHero, source, importTag, platform, sourceGameId, sourceUrl, &[platform+sourceGameId]',
    positions: '++id, gameId, fen, eval, classification, bestMove, phase, tags, questionType, nextReviewAt',
    openings: 'eco, name, winRate, frequency, masterMoves',
    ai_analyses: '++id, gameId, promptVersion, createdAt',
    importProgress: 'username, [platform+usernameLower], platform, usernameLower, currentSince, targetUntil, totalImported, lastUpdated, status, mode, failedChunks, cursor',
    heroProfiles: '++id, &[platform+usernameLower], platform, usernameLower, displayName, createdAt'
});

db.version(21).stores({
    games: '++id, lichessId, pgnHash, site, date, white, black, result, eco, openingName, [white+result], [black+result], timestamp, analyzed, analysisStatus, analysisStartedAt, whiteRating, blackRating, perf, speed, timeControl, analyzedAt, priority, rated, variant, whiteTitle, blackTitle, isHero, source, importTag, platform, sourceGameId, sourceUrl, &[platform+sourceGameId]',
    positions: '++id, gameId, fen, eval, classification, bestMove, phase, tags, questionType, nextReviewAt',
    openings: 'eco, name, winRate, frequency, masterMoves',
    ai_analyses: '++id, gameId, promptVersion, createdAt',
    importProgress: 'username, [platform+usernameLower], platform, usernameLower, currentSince, targetUntil, totalImported, lastUpdated, status, mode, failedChunks, cursor',
    heroProfiles: '++id, &[platform+usernameLower], platform, usernameLower, displayName, createdAt',
    gameContent: 'gameId, pgnHash, updatedAt',
    gameAnalysis: 'gameId, updatedAt'
}).upgrade(async (tx) => {
    const gamesTable = tx.table('games');
    const contentTable = tx.table('gameContent');
    const analysisTable = tx.table('gameAnalysis');
    const now = new Date().toISOString();

    const contentBatch = [];
    const analysisBatch = [];
    const flushContent = async () => {
        if (contentBatch.length) {
            const chunk = contentBatch.splice(0, contentBatch.length);
            await contentTable.bulkPut(chunk);
        }
    };
    const flushAnalysis = async () => {
        if (analysisBatch.length) {
            const chunk = analysisBatch.splice(0, analysisBatch.length);
            await analysisTable.bulkPut(chunk);
        }
    };

    await gamesTable.toCollection().each(async (g) => {
        if (g?.pgn) {
            contentBatch.push({
                gameId: g.id,
                pgn: g.pgn,
                pgnHash: g.pgnHash || '',
                updatedAt: now
            });
        }
        if (Array.isArray(g?.analysisLog) && g.analysisLog.length > 0) {
            analysisBatch.push({
                gameId: g.id,
                analysisLog: g.analysisLog,
                updatedAt: now
            });
        }
        if (contentBatch.length >= 200) await flushContent();
        if (analysisBatch.length >= 50) await flushAnalysis();
    });

    await flushContent();
    await flushAnalysis();

    await gamesTable.toCollection().modify((g) => {
        if (g?.pgn) g.pgn = null;
        if (Array.isArray(g?.analysisLog) && g.analysisLog.length > 0) g.analysisLog = [];
    });
});

export const saveAIAnalysis = async (gameId, analysisData, promptVersion = '1.0') => {
    const existing = await db.ai_analyses.where('gameId').equals(gameId).first();
    const record = {
        gameId,
        promptVersion,
        raw_json: analysisData, // Store the full validated input as-is
        createdAt: Date.now()
    };

    if (existing) {
        return await db.ai_analyses.update(existing.id, record);
    } else {
        return await db.ai_analyses.add(record);
    }
};

export const getAIAnalysis = async (gameId) => {
    return await db.ai_analyses.where('gameId').equals(gameId).first();
};

export const addGames = async (games) => {
    if (!Array.isArray(games) || games.length === 0) return [];
    const stripped = games.map((g) => {
        if (!g) return g;
        const { pgn, analysisLog, ...rest } = g;
        return { ...rest };
    });
    const keys = await db.games.bulkAdd(stripped);
    const contentRecords = [];
    games.forEach((g, idx) => {
        if (g?.pgn && keys[idx]) {
            contentRecords.push({
                gameId: keys[idx],
                pgn: g.pgn,
                pgnHash: g.pgnHash || '',
                updatedAt: new Date().toISOString()
            });
        }
    });
    if (contentRecords.length) {
        await db.gameContent.bulkPut(contentRecords);
    }
    return keys;
};

const extractPgnTag = (pgn, tag) => {
    if (!pgn || !tag) return '';
    const match = pgn.match(new RegExp(`\\[${tag} "([^"]*)"\\]`));
    const value = match ? match[1] : '';
    if (!value || value === '?' || value === '-') return '';
    return value.trim();
};

const isMissingTitle = (value) => !value || value === '?' || value === '-';

export const backfillTitlesFromPgn = async () => {
    try {
        await db.transaction('rw', db.games, db.gameContent, async () => {
            const content = await db.gameContent.toArray();
            const pgnByGameId = new Map(content.map((c) => [c.gameId, c.pgn]));
            await db.games.toCollection().modify((g) => {
                const pgn = pgnByGameId.get(g.id);
                if (!pgn) return;
                const needsWhite = isMissingTitle(g.whiteTitle);
                const needsBlack = isMissingTitle(g.blackTitle);
                if (!needsWhite && !needsBlack) return;
                if (needsWhite) {
                    const whiteTitle = extractPgnTag(pgn, 'WhiteTitle');
                    if (whiteTitle) g.whiteTitle = whiteTitle;
                }
                if (needsBlack) {
                    const blackTitle = extractPgnTag(pgn, 'BlackTitle');
                    if (blackTitle) g.blackTitle = blackTitle;
                }
            });
        });
    } catch (error) {
        console.warn('Backfill titles failed:', error);
    }
};

const inferPlatform = (g) => {
    if (!g) return 'unknown';
    const raw = g.platform || g.source || (g.lichessId ? 'lichess' : '') || (g.pgnHash ? 'pgn' : '');
    return (raw || 'unknown').toLowerCase();
};

export const bulkUpsertGames = async (games) => {
    const normalizedGames = games.map((g) => {
        if (!g) return g;
        const { pgn, analysisLog, ...rest } = g;
        const next = { ...rest };
        if (!next.platform) {
            if (next.source) next.platform = next.source;
            else if (next.lichessId) next.platform = 'lichess';
            else if (next.pgnHash) next.platform = 'pgn';
        }
        if (!next.sourceGameId) {
            if (next.platform === 'lichess' && next.lichessId) next.sourceGameId = next.lichessId;
            if (next.platform === 'pgn' && next.pgnHash) next.sourceGameId = next.pgnHash;
        }
        return next;
    });

    const compoundKeys = normalizedGames
        .map(g => (g?.platform && g?.sourceGameId ? [g.platform, g.sourceGameId] : null))
        .filter(Boolean);

    const existing = compoundKeys.length
        ? await db.games.where('[platform+sourceGameId]').anyOf(compoundKeys).toArray()
        : [];
    const existingIdsMap = new Map(existing.map(g => [`${g.platform}::${g.sourceGameId}`, g.id]));

    const toPut = normalizedGames.map(g => {
        if (g?.platform && g?.sourceGameId) {
            const key = `${g.platform}::${g.sourceGameId}`;
            if (existingIdsMap.has(key)) {
                return { ...g, id: existingIdsMap.get(key) };
            }
        }
        return g;
    });
    const keys = await db.games.bulkPut(toPut);

    const contentRecords = [];
    const analysisRecords = [];
    const now = new Date().toISOString();
    games.forEach((g, idx) => {
        const gameId = keys[idx] ?? toPut[idx]?.id;
        if (!gameId) return;
        if (g?.pgn) {
            contentRecords.push({
                gameId,
                pgn: g.pgn,
                pgnHash: g.pgnHash || '',
                updatedAt: now
            });
        }
        if (Array.isArray(g?.analysisLog) && g.analysisLog.length) {
            analysisRecords.push({
                gameId,
                analysisLog: g.analysisLog,
                updatedAt: now
            });
        }
    });
    if (contentRecords.length) {
        await db.gameContent.bulkPut(contentRecords);
    }
    if (analysisRecords.length) {
        await db.gameAnalysis.bulkPut(analysisRecords);
    }

    return keys;
};

export const getGameContent = async (gameId) => {
    if (!gameId) return null;
    return await db.gameContent.get(gameId);
};

export const getGamePgn = async (gameId) => {
    const content = await getGameContent(gameId);
    return content?.pgn || '';
};

export const saveGameContent = async ({ gameId, pgn, pgnHash }) => {
    if (!gameId || !pgn) return;
    const record = {
        gameId,
        pgn,
        pgnHash: pgnHash || '',
        updatedAt: new Date().toISOString()
    };
    await db.gameContent.put(record);
};

export const deleteGameContent = async (gameId) => {
    if (!gameId) return;
    await db.gameContent.delete(gameId);
};

export const getGameAnalysis = async (gameId) => {
    if (!gameId) return null;
    return await db.gameAnalysis.get(gameId);
};

export const saveGameAnalysis = async ({ gameId, analysisLog }) => {
    if (!gameId) return;
    await db.gameAnalysis.put({
        gameId,
        analysisLog: Array.isArray(analysisLog) ? analysisLog : [],
        updatedAt: new Date().toISOString()
    });
};

export const deleteGameAnalysis = async (gameId) => {
    if (!gameId) return;
    await db.gameAnalysis.delete(gameId);
};

export const getLatestGameTimestampForProfile = async (platform, username) => {
    if (!platform || !username) return 0;
    const lowerUser = username.toLowerCase();
    const targetPlatform = platform.toLowerCase();
    const latest = await db.games
        .filter(g => {
            const gamePlatform = inferPlatform(g);
            if (gamePlatform !== targetPlatform) return false;
            const isHero = g.white?.toLowerCase() === lowerUser || g.black?.toLowerCase() === lowerUser;
            return isHero;
        })
        .reverse()
        .sortBy('timestamp');

    return latest.length > 0 ? latest[0].timestamp : 0;
};

// Count distinct days with activity for a profile within a timestamp range
export const getDistinctGameDaysInRange = async (platform, username, since, until) => {
    const lowerUser = username.toLowerCase();
    const targetPlatform = platform.toLowerCase();
    const games = await db.games
        .filter(g => {
            const gamePlatform = inferPlatform(g);
            if (gamePlatform !== targetPlatform) return false;
            if (g.timestamp < since || g.timestamp >= until) return false;
            const isHero = g.white?.toLowerCase() === lowerUser || g.black?.toLowerCase() === lowerUser;
            return isHero;
        })
        .toArray();

    const uniqueDays = new Set(games.map(g => new Date(g.timestamp).toDateString()));
    return uniqueDays.size;
};

export const getGame = async (id) => {
    return await db.games.get(id);
};

// Import Progress Management
const buildImportProgressKey = (platform, usernameLower) => `${platform}:${usernameLower}`;

export const saveImportProgress = async (platform, username, progress) => {
    const usernameLower = username.toLowerCase();
    const safePlatform = platform.toLowerCase();
    await db.importProgress.put({
        username: buildImportProgressKey(safePlatform, usernameLower),
        platform: safePlatform,
        usernameLower,
        targetSince: progress.targetSince ?? null,
        currentSince: progress.currentSince,
        targetUntil: progress.targetUntil,
        totalImported: progress.totalImported || 0,
        lastUpdated: Date.now(),
        status: progress.status, // 'in-progress', 'paused', 'completed', 'failed'
        mode: progress.mode || 'smart',
        failedChunks: JSON.stringify(progress.failedChunks || []),
        cursor: typeof progress.cursor === 'number' ? progress.cursor : null
    });
};

export const loadImportProgress = async (platform, username) => {
    if (!platform || !username) return null;
    const usernameLower = username.toLowerCase();
    const safePlatform = platform.toLowerCase();
    const key = buildImportProgressKey(safePlatform, usernameLower);
    let progress = await db.importProgress.get(key);

    // Fallback for legacy (v17) lichess imports
    if (!progress && safePlatform === 'lichess') {
        const legacy = await db.importProgress.get(usernameLower);
        if (legacy) {
            progress = {
                ...legacy,
                username: key,
                platform: safePlatform,
                usernameLower
            };
            await db.importProgress.delete(usernameLower);
            await db.importProgress.put(progress);
        }
    }

    if (progress && progress.failedChunks) {
        try {
            progress.failedChunks = JSON.parse(progress.failedChunks);
        } catch {
            progress.failedChunks = [];
        }
    }
    return progress;
};

export const clearImportProgress = async (platform, username) => {
    if (!platform || !username) return;
    const usernameLower = username.toLowerCase();
    const safePlatform = platform.toLowerCase();
    await db.importProgress.delete(buildImportProgressKey(safePlatform, usernameLower));
};
