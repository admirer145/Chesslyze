import Dexie from 'dexie';

export const db = new Dexie('ReelChessDB');

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
    return await db.games.bulkAdd(games);
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
        await db.transaction('rw', db.games, async () => {
            await db.games.toCollection().modify((g) => {
                if (!g?.pgn) return;
                const needsWhite = isMissingTitle(g.whiteTitle);
                const needsBlack = isMissingTitle(g.blackTitle);
                if (!needsWhite && !needsBlack) return;
                if (needsWhite) {
                    const whiteTitle = extractPgnTag(g.pgn, 'WhiteTitle');
                    if (whiteTitle) g.whiteTitle = whiteTitle;
                }
                if (needsBlack) {
                    const blackTitle = extractPgnTag(g.pgn, 'BlackTitle');
                    if (blackTitle) g.blackTitle = blackTitle;
                }
            });
        });
    } catch (error) {
        console.warn('Backfill titles failed:', error);
    }
};

export const bulkUpsertGames = async (games) => {
    // We use lichessId as the unique key to check for duplicates
    // Since we want to update if it exists or add if not, bulkPut is suitable if the PK is lichessId,
    // but here ++id is the primary key. So we should probably check existence.
    // However, if we trust lichessId to be unique enough, we can use it.
    // Let's implement a manual upsert since lichessId is indexed but not the PK.
    const gameIds = games.map(g => g.lichessId).filter(Boolean);
    const existing = await db.games.where('lichessId').anyOf(gameIds).toArray();
    const existingIdsMap = new Map(existing.map(g => [g.lichessId, g.id]));

    const toPut = games.map(g => {
        if (g.lichessId && existingIdsMap.has(g.lichessId)) {
            return { ...g, id: existingIdsMap.get(g.lichessId) };
        }
        return g;
    });

    return await db.games.bulkPut(toPut);
};

export const getLatestGameTimestamp = async (username) => {
    const latest = await db.games
        .filter(g => {
            if (typeof g.isHero === 'boolean') return g.isHero;
            const isHero = username && (g.white?.toLowerCase() === username.toLowerCase() || g.black?.toLowerCase() === username.toLowerCase());
            return !!isHero;
        })
        .reverse()
        .sortBy('timestamp');

    return latest.length > 0 ? latest[0].timestamp : 0;
};

export const getGame = async (id) => {
    return await db.games.get(id);
};
