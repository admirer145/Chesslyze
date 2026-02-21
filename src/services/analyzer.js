import { db, getGamePgn, getGameAnalysis, saveGameAnalysis, saveGameContent } from './db';
import { storePuzzlePositions } from './puzzles';
import { getHeroProfiles, getHeroSideFromGame } from './heroProfiles';
import { engine } from './engine';
import { Chess } from 'chess.js';
import { getDefaultEngineVersion } from './engineDefaults';
import { fetchChessComGamePgn } from './chesscom';

const THRESHOLDS = {
    BLUNDER: 250,
    MISTAKE: 100,
    INACCURACY: 40,
    GOOD: 10,
    BEST: 10
};

const WINNING_THRESHOLD = 200;
const ACCURACY_STREAK = 90;

const MATE_SCORE = 100000;
const mateToCp = (mate) => {
    if (typeof mate !== 'number') return null;
    const dist = Math.min(99, Math.abs(mate));
    return Math.sign(mate) * (MATE_SCORE - dist * 100);
};

const evalToCp = (line) => {
    if (!line || typeof line !== 'object') return 0;
    if (typeof line.mate === 'number') return mateToCp(line.mate);
    if (typeof line.score === 'number') return line.score;
    return 0;
};

const clampInt = (value, min, max, fallback) => {
    const parsed = parseInt(value, 10);
    if (Number.isNaN(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
};

const publicAssetCache = new Map();
const resolvePublicUrl = (filename) => {
    if (typeof window === 'undefined') return filename;
    const base = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.BASE_URL)
        ? import.meta.env.BASE_URL
        : '/';
    const normalized = base.endsWith('/') ? base : `${base}/`;
    return new URL(`${normalized}${filename}`, window.location.origin).href;
};

const checkPublicAsset = async (filename) => {
    if (publicAssetCache.has(filename)) return publicAssetCache.get(filename);
    if (typeof fetch !== 'function' || typeof window === 'undefined') {
        publicAssetCache.set(filename, false);
        return false;
    }

    const url = resolvePublicUrl(filename);
    let ok = false;
    try {
        const head = await fetch(url, { method: 'HEAD', cache: 'force-cache' });
        const ct = head.headers && head.headers.get ? head.headers.get('content-type') : '';
        ok = head.ok && !(ct && ct.includes('text/html'));
    } catch {
        ok = false;
    }

    if (!ok) {
        try {
            const res = await fetch(url, { method: 'GET', cache: 'force-cache' });
            const ct = res.headers && res.headers.get ? res.headers.get('content-type') : '';
            ok = res.ok && !(ct && ct.includes('text/html'));
        } catch {
            ok = false;
        }
    }

    publicAssetCache.set(filename, ok);
    return ok;
};

const loadActiveEngineProfile = () => {
    if (typeof window === 'undefined') return null;
    try {
        const rawProfiles = localStorage.getItem('engineProfiles');
        const activeId = localStorage.getItem('activeEngineProfileId');
        if (!rawProfiles) return null;
        const parsed = JSON.parse(rawProfiles);
        if (!Array.isArray(parsed) || !parsed.length) return null;
        const selected = parsed.find((p) => p?.id === activeId) || parsed[0];

        // Return with new limits and version
        return {
            depth: clampInt(selected?.depth ?? 15, 8, 60, 15),
            multiPv: clampInt(selected?.multiPv ?? 1, 1, 5, 1),
            deepDepth: clampInt(selected?.deepDepth ?? 0, 0, 60, 0),
            hash: clampInt(selected?.hash ?? 32, 16, 256, 32),
            threads: clampInt(selected?.threads ?? 1, 1, 32, 1),
            timePerMove: clampInt(selected?.timePerMove ?? 0, 0, 60000, 0),
            useNNUE: typeof selected?.useNNUE === 'boolean' ? selected.useNNUE : true,
            version: selected?.version || getDefaultEngineVersion()
        };
    } catch {
        return null;
    }
};

// Calculate accuracy based on centipawn loss (0-100)
// Formula: 100 * exp(-0.002 * cpLoss)
const calculateAccuracy = (cpLoss) => {
    // Cap loss at 500 for calculation sanity
    const cappedLoss = Math.min(Math.abs(cpLoss), 1000);
    return Math.round(100 * Math.exp(-0.002 * cappedLoss));
};

const applyClassificationPenalty = (accuracy, classification) => {
    const penalties = {
        book: 0,
        blunder: 25,
        mistake: 15,
        inaccuracy: 8,
        good: 2,
        best: 0,
        great: 0,
        brilliant: 0
    };
    const penalty = penalties[classification] || 0;
    return Math.max(0, accuracy - penalty);
};

const getClassification = ({
    evalDiff,
    isBestMove,
    isExactBest,
    isTopLine,
    scoreBefore,
    scoreAfter,
    materialDelta,
    pvMaterialDelta,
    phase,
    gapToSecond,
    secondScoreCp,
    playerRating,
    isRecapture,
    motifs
}) => {
    const before = typeof scoreBefore === 'number' ? scoreBefore : 0;
    const after = typeof scoreAfter === 'number' ? scoreAfter : 0;
    const motifsArr = Array.isArray(motifs) ? motifs : [];

    const isOpening = phase === 'opening';

    // --- Core thresholds (centipawns) ---
    const WINNING = 200;        // +2.0  — clearly winning
    const CLEAR_EDGE = 150;     // +1.5  — solid advantage
    const SLIGHT_EDGE = 80;     // +0.8  — moderate edge
    const NEAR_EQUAL = 50;      // ±0.5  — roughly equal

    // --- Helpers for position brackets ---
    const isMateScore = (cp) => Math.abs(cp) >= MATE_SCORE - 10000;
    const bothMatesForSameSide = isMateScore(before) && isMateScore(after) &&
        Math.sign(before) === Math.sign(after);

    const beforeWinning = before >= WINNING;
    const afterWinning = after >= WINNING;
    const beforeLosing = before <= -WINNING;
    const afterLosing = after <= -WINNING;
    const stillWinning = beforeWinning && after >= SLIGHT_EDGE;
    const stillLosing = beforeLosing && afterLosing;

    const sacrifice = materialDelta <= -2;
    const deferredMajorSac = typeof pvMaterialDelta === 'number' && pvMaterialDelta <= -5;
    const majorMaterialLoss = materialDelta <= -5; // rook/queen

    const rating = typeof playerRating === 'number' ? playerRating : null;
    const brilliantFactor = rating ? (rating < 1200 ? 0.9 : rating < 1600 ? 0.95 : 1) : 1;

    const secondScore = typeof secondScoreCp === 'number' ? secondScoreCp : null;
    const gap = typeof gapToSecond === 'number' ? gapToSecond : null;

    // Opening forgiveness — be more lenient in book territory
    const multiplier = isOpening ? 1.4 : 1;

    // Tactical motifs present in the position
    const hasTacticalMotif = motifsArr.some(m => ['fork', 'pin', 'skewer'].includes(m));

    // =========================
    // BEST / GREAT / BRILLIANT
    // =========================
    if (isBestMove) {
        const immediateSac = materialDelta <= -2;
        const pieceSac = materialDelta <= -3; // minor piece or more
        const BRILLIANT_GAP = (isOpening ? 140 : 120) * brilliantFactor;

    // 🔥 BRILLIANT: Best move + genuine sacrifice + non-obvious
    // Requires:
    //  - Not a simple recapture
    //  - Genuine material sacrifice (piece-level, OR minor + tactical motif)
    //  - Not already in an overwhelming position (< +5.0)
    //  - Position stays reasonable after the sacrifice
    //  - Move stands out from alternatives (gap to second best)
        const notOverwhelming = before < 350;
        const positionHeld = after >= -NEAR_EQUAL && after >= before - 50;
        const standoutMove = gap !== null && gap >= BRILLIANT_GAP;
        const isBestish = !!(isExactBest || (isTopLine && evalDiff <= THRESHOLDS.BEST * 0.7) || isBestMove);
        const complexPosition = Math.abs(before) <= 300;
        const improves = (after - before) >= 60;
        const winningSac = majorMaterialLoss && (isMateScore(after) || after >= WINNING);
        const mateAfter = isMateScore(after) && after > 0;
        const nonOverwhelmingOrMate = notOverwhelming || winningSac || mateAfter;
        const deferredSacEligible = deferredMajorSac &&
            (standoutMove || mateAfter) &&
            nonOverwhelmingOrMate &&
            (after >= -NEAR_EQUAL || winningSac || mateAfter) &&
            (hasTacticalMotif || improves || complexPosition || mateAfter);
        const forcedMateSac = deferredMajorSac && mateAfter;

        if (
            !isRecapture &&
            isBestish &&
            (
                (sacrifice && nonOverwhelmingOrMate && (
                    // Path A: Major sacrifice leading to winning/mate even if already better
                    winningSac ||
                    // Path B: Piece-level sacrifice with standout or big improvement in a complex position
                    (pieceSac && (standoutMove || (improves && complexPosition))) ||
                    // Path C: Smaller sacrifice with a tactical motif and clear separation
                    (immediateSac && hasTacticalMotif && standoutMove)
                )) ||
                // Path D: Deferred major sacrifice (e.g., hanging queen) that stands out
                deferredSacEligible ||
                // Path E: Forced mate with a deferred major sacrifice (e.g., hanging queen)
                forcedMateSac
            )
        ) {
            return 'brilliant';
        }

        // ⭐ GREAT: Best move in a truly critical moment — rare and special
        // Only triggers when the move is exceptionally important:
        //  1. Recovered from a losing position (was -2.0+, now near equal or better)
        //  2. Only move that prevents disaster (second-best leads to losing)
        //  3. Found the move to convert from equal to winning with difficulty

        const recoveredFromLosing =
            before <= -WINNING &&
            after >= -SLIGHT_EDGE;

        const savedFromCollapse =
            before <= -CLEAR_EDGE &&
            after >= -SLIGHT_EDGE &&
            secondScore !== null &&
            secondScore <= -CLEAR_EDGE; // second-best leads to trouble

        const onlyMovePreventingDisaster =
            gap !== null && gap >= 140 &&
            secondScore !== null &&
            secondScore <= -SLIGHT_EDGE &&
            after >= -NEAR_EQUAL;

        const criticalConversion =
            Math.abs(before) <= SLIGHT_EDGE &&
            after >= CLEAR_EDGE &&
            gap !== null && gap >= 120;

        const decisiveSwing =
            isBestish &&
            !isRecapture &&
            complexPosition &&
            (after - before) >= 120;

        const isGreat =
            recoveredFromLosing ||
            savedFromCollapse ||
            onlyMovePreventingDisaster ||
            criticalConversion ||
            decisiveSwing;

        if (isGreat && !isRecapture && isBestish) {
            return 'great';
        }

        return 'best';
    }

    // =========================
    // NON-BEST MOVES
    // =========================

    // --- Mate-zone protection ---
    // If both evaluations are forced mates for the same side, never worse than inaccuracy.
    // Mate-in-4 → Mate-in-7 is NOT a blunder, you're still winning with checkmate guaranteed.
    if (bothMatesForSameSide) {
        if (evalDiff > THRESHOLDS.INACCURACY) return 'inaccuracy';
        return 'good';
    }

    // --- Still winning protection ---
    // If you were winning and you're STILL clearly winning, cap severity.
    // Losing some advantage while comfortably winning is not a blunder.
    if (stillWinning) {
        if (evalDiff <= 150 * multiplier) return 'good';
        if (evalDiff <= 300 * multiplier) return 'inaccuracy';
        return 'mistake'; // cap — never blunder if still winning
    }

    // --- Still losing protection ---
    // If you were losing and still losing, cap at mistake (you can't lose what you didn't have)
    if (stillLosing && !majorMaterialLoss) {
        if (evalDiff <= 200 * multiplier) return 'good';
        if (evalDiff <= 400 * multiplier) return 'inaccuracy';
        return 'mistake'; // cap
    }

    // --- Hard blunder: evaluation bracket flip ---
    // Winning → Losing or Winning → Equal (devastating collapse)
    if (
        (before >= CLEAR_EDGE && after <= -SLIGHT_EDGE) ||
        (before <= -CLEAR_EDGE && after >= SLIGHT_EDGE)
    ) {
        return 'blunder';
    }

    // --- Material blunder: major piece loss that puts you in a losing position ---
    if (majorMaterialLoss && after <= -CLEAR_EDGE) {
        return 'blunder';
    }

    // --- Opening sacrifice forgiveness ---
    if (isOpening && sacrifice && after > -CLEAR_EDGE) {
        return 'good';
    }

    // --- Blunder by eval loss: only if position character fundamentally changes ---
    if (
        evalDiff > THRESHOLDS.BLUNDER * multiplier &&
        (!isOpening || evalDiff > 300) &&
        // Must cross from positive to negative territory (or near it)
        (after <= -SLIGHT_EDGE || (before >= SLIGHT_EDGE && after <= NEAR_EQUAL))
    ) {
        return 'blunder';
    }

    // --- Mistake: meaningful advantage lost ---
    if (
        evalDiff > THRESHOLDS.MISTAKE * multiplier &&
        (before >= SLIGHT_EDGE || after <= -SLIGHT_EDGE)
    ) {
        return 'mistake';
    }

    // --- Inaccuracy: suboptimal but not damaging ---
    if (evalDiff > THRESHOLDS.INACCURACY * multiplier) {
        return 'inaccuracy';
    }

    return 'good';
};

const materialScore = (fen) => {
    const chess = new Chess(fen);
    const board = chess.board();
    const values = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
    let white = 0;
    let black = 0;

    for (const row of board) {
        for (const piece of row) {
            if (!piece) continue;
            const value = values[piece.type] || 0;
            if (piece.color === 'w') white += value;
            else black += value;
        }
    }

    return { white, black };
};

const uciToMove = (uci) => {
    if (!uci || typeof uci !== 'string' || uci.length < 4) return null;
    return {
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci.length > 4 ? uci.slice(4, 5) : undefined
    };
};

const estimatePvMaterialDelta = (fen, pv, maxPlies = 8) => {
    if (!fen || !pv) return null;
    const tokens = String(pv).split(' ').filter(Boolean).slice(0, maxPlies);
    if (!tokens.length) return null;
    const chess = new Chess(fen);
    const before = materialScore(fen);
    const startTurn = chess.turn();

    let plies = 0;
    for (const token of tokens) {
        const move = uciToMove(token);
        if (!move) break;
        const res = chess.move({ from: move.from, to: move.to, promotion: move.promotion });
        if (!res) break;
        plies += 1;
    }

    if (plies === 0) return null;
    const after = materialScore(chess.fen());
    const delta = startTurn === 'w'
        ? (after.white - before.white)
        : (after.black - before.black);
    return { delta, plies };
};

const materialTotal = (fen) => {
    const score = materialScore(fen);
    return score.white + score.black;
};

const getGamePhase = (ply, material) => {
    if (ply <= 20) return 'opening';
    if (material <= 14) return 'endgame';
    return 'middlegame';
};

const fenKey = (fen) => {
    if (!fen || typeof fen !== 'string') return '';
    // Ignore move clocks to make book lookups stable across transpositions/time.
    return fen.split(' ').slice(0, 4).join(' ');
};

const getSquareCoords = (square) => {
    const file = square.charCodeAt(0) - 97;
    const rank = parseInt(square[1], 10) - 1;
    return { file, rank };
};

const inBounds = (file, rank) => file >= 0 && file <= 7 && rank >= 0 && rank <= 7;

const getPieceAt = (board, file, rank) => {
    if (!inBounds(file, rank)) return null;
    return board[7 - rank][file];
};

const detectPin = (chess, move, board) => {
    const piece = chess.get(move.to);
    if (!piece || !['b', 'r', 'q'].includes(piece.type)) return false;

    const directions = [];
    if (piece.type === 'b' || piece.type === 'q') {
        directions.push([1, 1], [1, -1], [-1, 1], [-1, -1]);
    }
    if (piece.type === 'r' || piece.type === 'q') {
        directions.push([1, 0], [-1, 0], [0, 1], [0, -1]);
    }

    const { file, rank } = getSquareCoords(move.to);
    for (const [df, dr] of directions) {
        let f = file + df;
        let r = rank + dr;
        let first = null;
        while (inBounds(f, r)) {
            const p = getPieceAt(board, f, r);
            if (p) {
                if (!first) {
                    if (p.color === piece.color) break;
                    first = p;
                } else {
                    if (p.color !== piece.color && p.type === 'k') return true;
                    break;
                }
            }
            f += df;
            r += dr;
        }
    }
    return false;
};

const detectSkewer = (chess, move, board) => {
    const piece = chess.get(move.to);
    if (!piece || !['b', 'r', 'q'].includes(piece.type)) return false;
    if (!chess.inCheck()) return false;

    const directions = [];
    if (piece.type === 'b' || piece.type === 'q') {
        directions.push([1, 1], [1, -1], [-1, 1], [-1, -1]);
    }
    if (piece.type === 'r' || piece.type === 'q') {
        directions.push([1, 0], [-1, 0], [0, 1], [0, -1]);
    }

    const { file, rank } = getSquareCoords(move.to);
    for (const [df, dr] of directions) {
        let f = file + df;
        let r = rank + dr;
        let hitKing = false;
        while (inBounds(f, r)) {
            const p = getPieceAt(board, f, r);
            if (p) {
                if (!hitKing) {
                    if (p.type === 'k') {
                        hitKing = true;
                    } else {
                        break;
                    }
                } else {
                    if (p.color !== piece.color && ['q', 'r', 'b', 'n'].includes(p.type)) return true;
                    break;
                }
            }
            f += df;
            r += dr;
        }
    }
    return false;
};

const detectFork = (chess, move) => {
    const moves = chess.moves({ square: move.to, verbose: true });
    const targets = new Set();
    moves.forEach((m) => {
        if (m.captured) targets.add(m.to);
    });
    return targets.size >= 2;
};

const detectMotifs = ({
    chessAfter,
    move,
    scoreBefore,
    myScoreAfter,
    materialDelta,
    pvMaterialDelta
}) => {
    const motifs = [];
    const board = chessAfter.board();

    if (detectFork(chessAfter, move)) motifs.push('fork');
    if (detectPin(chessAfter, move, board)) motifs.push('pin');
    if (detectSkewer(chessAfter, move, board)) motifs.push('skewer');
    const deferredSac = typeof pvMaterialDelta === 'number' && pvMaterialDelta <= -3;
    if ((materialDelta <= -3 || deferredSac) && myScoreAfter - scoreBefore >= 30) motifs.push('sacrifice');

    return motifs;
};

const generatePlanHint = ({ phase, motifs, classification }) => {
    if (phase === 'opening') {
        if (motifs.includes('pin')) return 'Pin the defender to gain easy development.';
        if (motifs.includes('fork')) return 'Look for forks on weakly defended pieces.';
        return 'Focus on rapid development and king safety.';
    }
    if (phase === 'endgame') {
        return 'Activate your king and simplify into favorable pawn endings.';
    }
    if (motifs.includes('sacrifice')) return 'Invest material for lasting initiative.';
    if (classification === 'blunder' || classification === 'mistake') return 'Slow down and calculate forcing lines.';
    return 'Improve piece activity and target weaknesses.';
};

const generateExplanation = (classification, evalDiff, move, bestMove) => {
    if (classification === 'book') return `Book move. This is a known opening line.`;
    if (classification === 'brilliant') return `Brilliant!! An outstanding sacrifice — ${move} is a deep, non-obvious move that the engine confirms as the best choice.`;
    if (classification === 'great') return `Great find! ${move} is a critical move — the only way to hold the position or turn the game around.`;
    if (classification === 'blunder') return `Blunder! This move fundamentally changes the position. You played ${move}, but ${bestMove} was necessary to maintain your standing.`;
    if (classification === 'mistake') return `Mistake. This move gives away a significant portion of your advantage. ${bestMove} was the stronger continuation.`;
    if (classification === 'inaccuracy') return `Inaccuracy. A slightly imprecise move — ${bestMove} was more accurate.`;
    if (classification === 'best') return `Best move. ${move} is the engine's top recommendation.`;
    if (classification === 'good') return `Good move. Solid and reasonable, though not the absolute best.`;
    return `Analysis: CP Loss ${Math.round(evalDiff)}`;
};

export const processGame = async (gameId) => {
    const game = await db.games.get(gameId);
    if (!game) return;
    if (game.analyzed) {
        // If a game is already analyzed but still marked pending, clear the stale queue state.
        if (game.analysisStatus === 'pending' || game.analysisStatus === 'analyzing') {
            await db.games.update(gameId, {
                analysisStatus: 'failed',
                analysisStartedAt: null,
                analysisHeartbeatAt: null
            });
        }
        return;
    }

    const heroProfiles = await getHeroProfiles();
    const heroSide = getHeroSideFromGame(game, heroProfiles);
    const explicitHero = typeof game.isHero === 'boolean' ? game.isHero : true;
    const platform = (game.platform || game.source || (game.lichessId ? 'lichess' : '') || (game.pgnHash ? 'pgn' : '') || '').toLowerCase();
    const allowAnonymous = platform === 'pgn' || platform === 'master' || platform === 'unknown';
    if (explicitHero && heroProfiles.length && !heroSide && !allowAnonymous) {
        await db.games.update(gameId, { analyzed: false, analysisStatus: 'ignored' });
        return;
    }

    let pgn = await getGamePgn(gameId);
    if ((!pgn || typeof pgn !== 'string') && typeof game?.pgn === 'string' && game.pgn.trim()) {
        pgn = game.pgn;
        await saveGameContent({ gameId, pgn, pgnHash: game.pgnHash || '' });
    }
    if ((!pgn || typeof pgn !== 'string') && game?.pgnHash) {
        const byHash = await db.gameContent.where('pgnHash').equals(game.pgnHash).first();
        if (byHash?.pgn) {
            pgn = byHash.pgn;
            await saveGameContent({ gameId, pgn, pgnHash: game.pgnHash || '' });
        }
    }
    if ((!pgn || typeof pgn !== 'string') && game?.sourceGameId) {
        const bySource = await db.gameContent.where('pgnHash').equals(game.sourceGameId).first();
        if (bySource?.pgn) {
            pgn = bySource.pgn;
            await saveGameContent({ gameId, pgn, pgnHash: game.pgnHash || game.sourceGameId || '' });
        }
    }
    if ((!pgn || typeof pgn !== 'string') && (game?.site || game?.sourceUrl)) {
        const rawUrl = (game.sourceUrl || game.site || '').toString().trim();
        try {
            const url = new URL(rawUrl);
            let fetched = '';
            if (url.hostname.includes('lichess.org')) {
                const id = url.pathname.split('/').filter(Boolean).pop();
                if (id) {
                    const res = await fetch(`https://lichess.org/game/export/${id}`);
                    if (res.ok) fetched = await res.text();
                }
            }
            if (fetched && fetched.trim()) {
                pgn = fetched.trim();
                await saveGameContent({ gameId, pgn, pgnHash: game.pgnHash || '' });
            }
        } catch {
            // ignore URL parsing/fetch errors
        }
    }
    if ((!pgn || typeof pgn !== 'string') && platform === 'chesscom') {
        try {
            const fetched = await fetchChessComGamePgn(game);
            if (fetched && fetched.trim()) {
                pgn = fetched.trim();
                await saveGameContent({ gameId, pgn, pgnHash: game.pgnHash || '' });
            }
        } catch {
            // ignore chess.com backfill errors
        }
    }
    if (!pgn || typeof pgn !== 'string') {
        console.warn(`Skipping analysis for game ${gameId}: Missing or invalid PGN.`);
        await db.games.update(gameId, {
            analyzed: true,
            analysisStatus: 'failed',
            analysisStartedAt: null,
            analysisHeartbeatAt: null
        });
        return;
    }

    const chess = new Chess();
    try {
        chess.loadPgn(pgn, { sloppy: true });
    } catch (e) {
        console.error(`Invalid PGN parsing for game ${gameId}`, e);
        await db.games.update(gameId, {
            analyzed: true,
            analysisStatus: 'failed',
            analysisStartedAt: null,
            analysisHeartbeatAt: null
        });
        return;
    }

    await db.games.update(gameId, {
        analysisStatus: 'analyzing',
        analysisStartedAt: new Date().toISOString(),
        analysisHeartbeatAt: new Date().toISOString()
    });

    const history = chess.history({ verbose: true });
    chess.reset();

    const existingRecord = await getGameAnalysis(gameId);
    const existingLog = Array.isArray(existingRecord?.analysisLog) ? existingRecord.analysisLog : [];
    const resuming = existingLog.length > 0 && existingLog.length < history.length;
    const analysisLog = resuming ? existingLog : [];

    if (!resuming) {
        // Only clear old positions if starting fresh
        await db.positions.where('gameId').equals(gameId).delete();
    }

    const reelPositions = [];
    let whiteAccuracySum = 0;
    let whiteMoves = 0;
    let blackAccuracySum = 0;
    let blackMoves = 0;
    let currentStreak = 0;
    let maxStreak = 0;
    let totalCpLoss = 0;
    let maxEvalSwing = 0;
    let prevScoreWhite = 0;

    // If resuming, restore state from existing log
    if (resuming) {
        for (const entry of analysisLog) {
            // Replay move to get board state correct
            const move = history.find(m =>
                (m.from + m.to + (m.promotion || '')).toLowerCase() === entry.move.toLowerCase()
            );
            if (move) chess.move(move);

            // Re-hydrate stats
            if (entry.turn === 'w') {
                // Approximate accuracy reconstruction not strictly needed for resume, 
                // but nice for final report. We can re-calculate if needed or just sum.
                // Simpler: Just rely on final summation at end? No, we need sums.
                // We'll trust the log has correct data.
                // Calculate accuracy from evalDiff stored in log
                const rawAcc = calculateAccuracy(entry.evalDiff);
                const acc = applyClassificationPenalty(rawAcc, entry.classification);
                whiteAccuracySum += acc;
                whiteMoves++;
            } else {
                const rawAcc = calculateAccuracy(entry.evalDiff);
                const acc = applyClassificationPenalty(rawAcc, entry.classification);
                blackAccuracySum += acc;
                blackMoves++;
            }
            totalCpLoss += entry.evalDiff;

            // Streak
            const rawAcc = calculateAccuracy(entry.evalDiff);
            const acc = applyClassificationPenalty(rawAcc, entry.classification);
            if (acc >= ACCURACY_STREAK) {
                currentStreak++;
                maxStreak = Math.max(maxStreak, currentStreak);
            } else {
                currentStreak = 0;
            }

            // Eval Swing
            const score = entry.score; // White POV
            maxEvalSwing = Math.max(maxEvalSwing, Math.abs(score - prevScoreWhite));
            prevScoreWhite = score;
        }
    }

    let bookMoves = [];
    let bookMoveByFen = null;
    try {
        if (game.eco) {
            const opening = await db.openings.get(game.eco);
            if (opening?.masterMoves?.length) bookMoves = opening.masterMoves;
            if (opening?.masterMoveByFen && typeof opening.masterMoveByFen === 'object') bookMoveByFen = opening.masterMoveByFen;
        }
    } catch (e) {
        console.warn("Failed to load opening book moves", e);
    }
    const getBookMovesForFen = (fen) => {
        const key = fenKey(fen);
        const arr = bookMoveByFen?.[key];
        if (Array.isArray(arr) && arr.length) return arr;
        return bookMoves;
    };

    const profile = loadActiveEngineProfile();
    const depthSetting = profile?.depth ?? parseInt(localStorage.getItem('engineDepth') || '15', 10);
    const depth = Number.isNaN(depthSetting) ? 15 : depthSetting;
    const shallowDepth = Math.max(8, depth - 4);
    const multiPvSetting = profile?.multiPv ?? parseInt(localStorage.getItem('engineMultiPv') || '1', 10);
    const multiPv = Number.isNaN(multiPvSetting) ? 1 : Math.max(1, Math.min(5, multiPvSetting));
    const deepDepthSetting = profile?.deepDepth ?? parseInt(localStorage.getItem('engineDeepDepth') || '0', 10);
    const deepDepthRaw = Number.isNaN(deepDepthSetting) ? 0 : deepDepthSetting;
    const deepDepth = Math.max(0, Math.min(60, deepDepthRaw));

    // Performance Settings
    const hashRaw = profile?.hash ?? parseInt(localStorage.getItem('engineHash') || '32', 10);
    const hash = Math.min(256, Math.max(1, hashRaw)); // Relax clamp for desktop/multi-thread

    const threadsRAW = profile?.threads ?? parseInt(localStorage.getItem('engineThreads') || '1', 10);
    const threads = Math.min(32, Math.max(1, threadsRAW)); // Allow multi-threading

    const timePerMoveRaw = profile?.timePerMove ?? parseInt(localStorage.getItem('engineTimePerMove') || '0', 10);
    const timePerMove = Math.max(0, timePerMoveRaw);

    const useNNUE = typeof profile?.useNNUE === 'boolean'
        ? profile.useNNUE
        : localStorage.getItem('engineUseNNUE') !== 'false'; // Default to true

    // Check if version changed
    const currentVersion = engine.version;
    const newVersion = profile?.version || getDefaultEngineVersion();

    console.log(`[Analyzer] Profile Version: ${newVersion}, Current Engine Version: ${currentVersion}`);

    if (currentVersion !== newVersion) {
        console.log(`[Analyzer] Switching engine version from ${currentVersion} to ${newVersion}`);
        // If engine not started, init with new version
        if (!engine.worker) {
            await engine.init(newVersion);
        } else {
            await engine.restart(newVersion);
        }
    }

    // Ensure engine options are up to date
    const engineOptions = [
        { name: 'Hash', value: hash },
        { name: 'Threads', value: threads }
    ];

    if (newVersion?.startsWith('17.1')) {
        // Stockfish 17.1 no longer has "Use NNUE" option
        // Only set EvalFile options if the engine supports them and assets exist.
        const caps = engine.getInfo()?.caps || {};
        const supportsEvalFile = !!(caps.evalFile || caps.evalFileSmall);

        if (supportsEvalFile) {
            const hasSmall = await checkPublicAsset('nn-37f18f62d772.nnue');
            const hasLarge = await checkPublicAsset('nn-1c0000000000.nnue');

            if (newVersion === '17.1-lite') {
                if (hasSmall) {
                    engineOptions.push({ name: 'EvalFile', value: 'nn-37f18f62d772.nnue' });
                    engineOptions.push({ name: 'EvalFileSmall', value: 'nn-37f18f62d772.nnue' });
                }
            } else if (hasLarge || hasSmall) {
                if (hasLarge) {
                    engineOptions.push({ name: 'EvalFile', value: 'nn-1c0000000000.nnue' });
                } else if (hasSmall) {
                    engineOptions.push({ name: 'EvalFile', value: 'nn-37f18f62d772.nnue' });
                }
                if (hasSmall) {
                    engineOptions.push({ name: 'EvalFileSmall', value: 'nn-37f18f62d772.nnue' });
                }
            }
        }
    } else {
        engineOptions.push({ name: 'Use NNUE', value: useNNUE });
        engineOptions.push({ name: 'EvalFile', value: 'nn-5af11540bbfe.nnue' });
    }

    engine.setOptions(engineOptions);

    const safeAnalyze = async (fen, opts) => {
        try {
            return await engine.analyze(fen, opts);
        } catch (e) {
            const msg = String(e?.message || e || '');
            if (msg.toLowerCase().includes('timeout')) {
                try {
                    await engine.restart();
                } catch {
                    // ignore
                }
                // If we timeout, we should probably fail the analysis rather than saving partial data.
                throw new Error('Analysis Timeout');
            }
            // For other errors, we might want to retry or fail.
            throw e;
        }
    };

    try {
        // Start from where we left off
        for (let i = analysisLog.length; i < history.length; i++) {

            const move = history[i];
            const fenBefore = chess.fen();
            const sideToMove = chess.turn(); // 'w' or 'b'
            const ply = i + 1;
            const playerRating = sideToMove === 'w'
                ? (game.whiteRating ?? game.whiteElo ?? null)
                : (game.blackRating ?? game.blackElo ?? null);
            const prevMove = i > 0 ? history[i - 1] : null;
            const isRecapture = !!(prevMove?.captured && move?.captured && move.to === prevMove.to);

            // 1. Analyze position BEFORE the move
            await db.games.update(gameId, { analysisHeartbeatAt: new Date().toISOString() });
            const result = await safeAnalyze(fenBefore, { depth, multiPv, movetime: timePerMove });
            let bestMoveUCI = (result.bestMove || '').toLowerCase();
            const evaluation = result.evaluation; // { score, mate, pv, multipv }
            let pvLines = Array.isArray(result.pvLines) ? result.pvLines : [];
            const bestLine = pvLines.find((l) => (l?.multipv || 1) === 1) || evaluation || {};
            // Stockfish "score" is from side-to-move POV; normalize to white POV for UI/graph stability.
            let scoreBeforeStm = typeof bestLine.score === 'number' ? bestLine.score : 0;
            let mateBeforeStm = typeof bestLine.mate === 'number' ? bestLine.mate : null;
            let scoreBeforeCp = evalToCp(bestLine);
            const scoreBeforeWhite = sideToMove === 'w' ? scoreBeforeStm : -scoreBeforeStm;
            const mateBeforeWhite = mateBeforeStm === null ? null : (sideToMove === 'w' ? mateBeforeStm : -mateBeforeStm);

            const normalizeEvalLine = (line) => {
                if (!line || typeof line !== 'object') return null;
                const rawScore = typeof line.score === 'number' ? line.score : null;
                const rawMate = typeof line.mate === 'number' ? line.mate : null;
                return {
                    ...line,
                    score: rawScore === null ? null : (sideToMove === 'w' ? rawScore : -rawScore),
                    mate: rawMate === null ? null : (sideToMove === 'w' ? rawMate : -rawMate),
                    scorePov: 'white'
                };
            };
            const pvLinesUi = pvLines.map(normalizeEvalLine).filter(Boolean);

            // 2. Identify User's Move
            const userMoveUCI = (move.from + move.to + (move.promotion || '')).toLowerCase();

            let classification = 'book';
            let evalDiff = 0;
            let myScoreAfter = scoreBeforeCp;
            let materialDelta = 0;

            // Check if user's move was already analyzed in the main search (PV lines)
            // `pvLines` contains raw engine output (Side-to-Move POV)
            const userLine = pvLines.find((l) => typeof l?.pv === 'string' && l.pv.split(' ')[0]?.toLowerCase() === userMoveUCI);
            const userScoreFromLines = userLine ? evalToCp(userLine) : null;

            // 3. Evaluate after move
            chess.move(move);
            const fenAfter = chess.fen();

            // OPTIMIZATION: If we found the move in the main search (depth N), 
            // use that score instead of re-analyzing at shallow depth (depth N-4).
            // This skips a redundant engine call for good/decent moves.
            let usedShallowAfter = false;
            if (userScoreFromLines !== null) {
                myScoreAfter = userScoreFromLines;
                // Still update heartbeat to prevent timeouts during long processing loops
                await db.games.update(gameId, { analysisHeartbeatAt: new Date().toISOString() });
            } else {
                // Not found in top lines (likely a mistake/blunder or MultiPV was low).
                // We must analyze the resulting position to know how bad it is.
                await db.games.update(gameId, { analysisHeartbeatAt: new Date().toISOString() });
                const resultAfter = await safeAnalyze(fenAfter, { depth: shallowDepth, multiPv: 1, movetime: timePerMove });
                const scoreAfter = evalToCp(resultAfter.evaluation);
                // After the move, side-to-move flips, so negate to keep perspective of the player who just moved.
                myScoreAfter = -scoreAfter;
                usedShallowAfter = true;
            }

            const chessAfter = new Chess(fenAfter);
            chess.undo();

            const beforeMaterial = materialScore(fenBefore);
            const afterMaterial = materialScore(fenAfter);
            if (sideToMove === 'w') {
                materialDelta = afterMaterial.white - beforeMaterial.white;
            } else {
                materialDelta = afterMaterial.black - beforeMaterial.black;
            }

            const phase = getGamePhase(ply, materialTotal(fenBefore));

            // If the move is best and we only used PV score, re-evaluate after move
            // to detect brilliant/great based on true post-move evaluation.
            if (!usedShallowAfter && userMoveUCI === bestMoveUCI) {
                const shouldRecheck =
                    materialDelta <= -2 || Math.abs(scoreBeforeCp) < 80;
                if (shouldRecheck) {
                    await db.games.update(gameId, { analysisHeartbeatAt: new Date().toISOString() });
                    const resultAfter = await safeAnalyze(fenAfter, { depth: shallowDepth, multiPv: 1, movetime: timePerMove });
                    const scoreAfter = evalToCp(resultAfter.evaluation);
                    myScoreAfter = -scoreAfter;
                    usedShallowAfter = true;
                }
            }

            // CP Loss
            // If userScoreFromLines existed, it EQUALS myScoreAfter, so evalDiff = scoreBefore - myScoreAfter
            evalDiff = Math.max(0, scoreBeforeCp - myScoreAfter);

            const bookMovesForFen = getBookMovesForFen(fenBefore) || [];
            const normalizedBookMoves = Array.isArray(bookMovesForFen)
                ? bookMovesForFen.map(m => String(m || '').toLowerCase())
                : [];
            const topLineMoves = pvLines.slice(0, Math.max(1, Math.min(3, multiPv)))
                .map((l) => (typeof l?.pv === 'string' ? l.pv.split(' ')[0] : null))
                .filter(Boolean)
                .map((m) => m.toLowerCase());
            const isInTopLines = topLineMoves.some((m) => m === userMoveUCI);
            const isOpening = phase === 'opening';
            const isExplicitBookMove =
                isOpening &&
                normalizedBookMoves.includes(userMoveUCI);
            const isEngineBookMove =
                isOpening &&
                normalizedBookMoves.length === 0 &&
                isInTopLines &&
                evalDiff <= THRESHOLDS.BEST * 0.5 &&   // stricter than "best"
                materialDelta >= -1 &&                // no real sacrifices
                Math.abs(scoreBeforeCp) <= 80;        // avoid unstable evals
            const isBookMove = isExplicitBookMove || isEngineBookMove;

            const bestThreshold = THRESHOLDS.BEST * (phase === 'opening' ? 1.3 : 1);
            const isBestMove = userMoveUCI === bestMoveUCI || evalDiff <= bestThreshold;

            const pvForUser = (userLine?.pv || bestLine?.pv || '').trim();
            const pvMaterial = estimatePvMaterialDelta(fenBefore, pvForUser, 6);

            let secondLine = pvLines.find((l) => (l?.multipv || 1) === 2);
            let secondScoreCp = secondLine ? evalToCp(secondLine) : null;
            let gapToSecond = secondScoreCp === null ? null : (scoreBeforeCp - secondScoreCp);

            // If user requested MultiPV=1, we won't have a second line.
            // For potential great/brilliant moves, do a quick 2-line probe to get the gap.
            if (gapToSecond === null && isBestMove && !isBookMove) {
                const needsGapCheck =
                    materialDelta <= -2 ||
                    (typeof pvMaterial?.delta === 'number' && pvMaterial.delta <= -5) ||
                    Math.abs(scoreBeforeCp) <= 300;
                if (needsGapCheck) {
                    try {
                        const gapResult = await safeAnalyze(fenBefore, { depth: shallowDepth, multiPv: 2, movetime: timePerMove });
                        const gapLines = Array.isArray(gapResult.pvLines) ? gapResult.pvLines : [];
                        const gapBestLine = gapLines.find((l) => (l?.multipv || 1) === 1) || gapResult.evaluation || {};
                        const gapSecondLine = gapLines.find((l) => (l?.multipv || 1) === 2);
                        const gapSecondScoreCp = gapSecondLine ? evalToCp(gapSecondLine) : null;
                        if (gapSecondScoreCp !== null) {
                            secondLine = gapSecondLine;
                            secondScoreCp = gapSecondScoreCp;
                            gapToSecond = evalToCp(gapBestLine) - gapSecondScoreCp;
                        }
                    } catch {
                        // If probe fails, keep gap null and continue.
                    }
                }
            }

            const motifs = detectMotifs({
                chessAfter,
                move,
                scoreBefore: scoreBeforeCp,
                myScoreAfter,
                materialDelta,
                pvMaterialDelta: pvMaterial?.delta
            });

            classification = getClassification({
                evalDiff,
                isBestMove,
                isExactBest: userMoveUCI === bestMoveUCI,
                isTopLine: isInTopLines,
                scoreBefore: scoreBeforeCp,
                scoreAfter: myScoreAfter,
                materialDelta,
                pvMaterialDelta: pvMaterial?.delta,
                phase,
                gapToSecond,
                secondScoreCp,
                playerRating,
                isRecapture,
                motifs
            });

            // Book is its own move-quality bucket (not "good/best") so stats are not confusing.
            if (isBookMove) classification = 'book';

            // Optional second pass: only re-check BLUNDERS at a deeper depth to reduce false positives
            // without making analysis unbearably slow.
            if (deepDepth > 0 && deepDepth > depth && classification === 'blunder' && !isBookMove) {
                try {
                    await db.games.update(gameId, { analysisHeartbeatAt: new Date().toISOString() });
                    const deepResult = await safeAnalyze(fenBefore, { depth: deepDepth, multiPv, timeoutMs: 12 * 60 * 1000 });
                    const deepPvLines = Array.isArray(deepResult.pvLines) ? deepResult.pvLines : [];
                    const deepBestMoveUCI = (deepResult.bestMove || bestMoveUCI).toLowerCase();
                    const deepBestLine = deepPvLines.find((l) => (l?.multipv || 1) === 1) || deepResult.evaluation || {};
                    const deepScoreBefore = typeof deepBestLine.score === 'number' ? deepBestLine.score : scoreBeforeStm;
                    const deepScoreBeforeCp = evalToCp(deepBestLine);
                    const deepMateBefore = typeof deepBestLine.mate === 'number' ? deepBestLine.mate : mateBeforeStm;

                    const deepUserLine = deepPvLines.find((l) => typeof l?.pv === 'string' && l.pv.split(' ')[0]?.toLowerCase() === userMoveUCI);
                    const deepUserScoreFromLines = deepUserLine ? evalToCp(deepUserLine) : null;
                    const deepScoreAfter = deepUserScoreFromLines ?? myScoreAfter;
                    const deepEvalDiff = Math.max(0, deepScoreBeforeCp - deepScoreAfter);

                    const deepSecondLine = deepPvLines.find((l) => (l?.multipv || 1) === 2);
                    const deepSecondScoreCp = deepSecondLine ? evalToCp(deepSecondLine) : null;
                    const deepGapToSecond = deepSecondScoreCp === null ? null : (deepScoreBeforeCp - deepSecondScoreCp);
                    const deepBestThreshold = THRESHOLDS.BEST * (phase === 'opening' ? 1.3 : 1);
                    const deepIsBestMove = userMoveUCI === deepBestMoveUCI || deepEvalDiff <= deepBestThreshold;

                    const deepIsTopLine = !!deepUserLine;
                    const deepClassification = getClassification({
                        evalDiff: deepEvalDiff,
                        isBestMove: deepIsBestMove,
                        isExactBest: userMoveUCI === deepBestMoveUCI,
                        isTopLine: deepIsTopLine,
                        scoreBefore: deepScoreBeforeCp,
                        scoreAfter: deepScoreAfter,
                        materialDelta,
                        pvMaterialDelta: pvMaterial?.delta,
                        phase,
                        gapToSecond: deepGapToSecond,
                        secondScoreCp: deepSecondScoreCp,
                        playerRating,
                        isRecapture,
                        motifs
                    });

                    // If the deep pass disagrees, trust it (prevents reels from being polluted).
                    bestMoveUCI = deepBestMoveUCI;
                    pvLines = deepPvLines;
                    scoreBeforeStm = deepScoreBefore;
                    scoreBeforeCp = deepScoreBeforeCp;
                    mateBeforeStm = deepMateBefore;
                    evalDiff = deepEvalDiff;
                    myScoreAfter = deepScoreAfter;
                    classification = deepClassification;
                } catch (e) {
                    // Ignore deep pass failures and keep the first pass result.
                }
            }
            const missedWin = scoreBeforeCp >= WINNING_THRESHOLD && evalDiff > THRESHOLDS.INACCURACY;
            const missedDefense = scoreBeforeCp <= -WINNING_THRESHOLD && evalDiff > THRESHOLDS.INACCURACY;

            const explanation = generateExplanation(classification, evalDiff, userMoveUCI, bestMoveUCI);
            const planHint = generatePlanHint({ phase, motifs, classification });

            // Accuracy
            const rawAccuracy = calculateAccuracy(evalDiff);
            const accuracy = applyClassificationPenalty(rawAccuracy, classification);
            totalCpLoss += evalDiff;
            if (accuracy >= ACCURACY_STREAK) {
                currentStreak += 1;
                maxStreak = Math.max(maxStreak, currentStreak);
            } else {
                currentStreak = 0;
            }
            if (sideToMove === 'w') {
                whiteAccuracySum += accuracy;
                whiteMoves++;
            } else {
                blackAccuracySum += accuracy;
                blackMoves++;
            }

            const scoreWhiteForStats = sideToMove === 'w' ? scoreBeforeStm : -scoreBeforeStm;
            const mateWhiteForStats = mateBeforeStm === null ? null : (sideToMove === 'w' ? mateBeforeStm : -mateBeforeStm);
            maxEvalSwing = Math.max(maxEvalSwing, Math.abs(scoreWhiteForStats - prevScoreWhite));
            prevScoreWhite = scoreWhiteForStats;

            analysisLog.push({
                ply,
                fen: fenBefore,
                move: userMoveUCI,
                bestMove: bestMoveUCI,
                pvLines: pvLines.map(normalizeEvalLine).filter(Boolean).slice(0, multiPv),
                score: scoreWhiteForStats, // Evaluation *before* the move (graph point), white POV
                mate: mateWhiteForStats,
                scorePov: 'white',
                classification,
                evalDiff,
                turn: sideToMove,
                phase,
                motifs,
                missedWin,
                missedDefense,
                planHint,
                bookMove: isBookMove
            });

            // Save progress every move so UI updates in real-time
            await saveGameAnalysis({ gameId, analysisLog });
            await db.games.update(gameId, {
                analysisHeartbeatAt: new Date().toISOString(),
                analysisProgress: Math.round(((i + 1) / Math.max(1, history.length)) * 100)
            });

            const tags = [
                classification,
                phase,
                ...motifs
            ];
            // Book is already represented by the classification.
            if (missedWin) tags.push('missedWin');
            if (missedDefense) tags.push('missedDefense');

            const questionType = classification === 'brilliant' || classification === 'great'
                ? 'find_brilliant'
                : missedWin
                    ? 'convert_win'
                    : missedDefense
                        ? 'find_defense'
                        : 'best_move';

            // Reel Data (Critical positions)
            if (['blunder', 'mistake', 'inaccuracy', 'brilliant', 'great'].includes(classification) || missedWin || missedDefense) {
                reelPositions.push({
                    gameId,
                    fen: fenBefore,
                    move: userMoveUCI,
                    bestMove: bestMoveUCI,
                    score: scoreWhiteForStats,
                    loss: evalDiff,
                    classification,
                    explanation,
                    turn: sideToMove,
                    ply,
                    phase,
                    tags,
                    motifs,
                    questionType,
                    missedWin,
                    missedDefense,
                    planHint,
                    nextReviewAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
                });
            }

            chess.move(move); // Apply move for next iteration
        }
    } catch (err) {
        console.error(`Analysis failed for game ${gameId}`, err);

        // Check for timeout or engine-related errors that warrant a retry
        const msg = String(err?.message || err || '').toLowerCase();
        const isTimeout = msg.includes('timeout') || msg.includes('worker');

        if (isTimeout) {
            const retryCount = (game.analysisRetryCount || 0) + 1;
            if (retryCount <= 3) {
                console.log(`[Analyzer] Requeuing game ${gameId} due to timeout (Attempt ${retryCount}/3)...`);
                // Reset to pending so queue picks it up again
                await db.games.update(gameId, {
                    analyzed: false,
                    analysisStatus: 'pending',
                    analysisStartedAt: null,
                    analysisHeartbeatAt: null,
                    analysisRetryCount: retryCount
                });
            } else {
                console.error(`[Analyzer] Game ${gameId} failed after ${retryCount - 1} retries.`);
                if (analysisLog.length > 0) {
                    await saveGameAnalysis({ gameId, analysisLog });
                }
                await db.games.update(gameId, {
                    analyzed: true,
                    analysisStatus: 'failed',
                    analysisRetryCount: retryCount
                });
            }
            return;
        }

        // Save partial analysis if we have any, so Dashboard can still show openings and some lines.
        if (analysisLog.length > 0) {
            try {
                await storePuzzlePositions(reelPositions);
            } catch {
                // ignore
            }
            await saveGameAnalysis({ gameId, analysisLog });
            await db.games.update(gameId, {
                analyzed: true,
                analysisStatus: 'failed',
                analysisStartedAt: null,
                analysisHeartbeatAt: null,
                analysisProgress: Math.round((analysisLog.length / Math.max(1, history.length)) * 100)
            });
        } else {
            await db.games.update(gameId, { analyzed: true, analysisStatus: 'failed', analysisStartedAt: null, analysisHeartbeatAt: null });
        }
        return;
    }

    // Save Reel Positions
    await storePuzzlePositions(reelPositions);

    await saveGameAnalysis({ gameId, analysisLog });

    // Save Game Analytics
    await db.games.update(gameId, {
        analyzed: true,
        analysisStatus: 'completed',
        analysisStartedAt: null,
        analysisHeartbeatAt: null,
        analysisProgress: 100,
        analyzedAt: new Date().toISOString(),
        accuracy: {
            white: whiteMoves ? Math.round(whiteAccuracySum / whiteMoves) : 0,
            black: blackMoves ? Math.round(blackAccuracySum / blackMoves) : 0
        },
        avgCpLoss: history.length ? Math.round(totalCpLoss / history.length) : 0,
        maxAccuracyStreak: maxStreak,
        maxEvalSwing
    });

    return analysisLog;
};
