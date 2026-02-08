import { db } from './db';
import { engine } from './engine';
import { Chess } from 'chess.js';

const THRESHOLDS = {
    BLUNDER: 300,
    MISTAKE: 100,
    INACCURACY: 40,
    GOOD: 15,
    BEST: 5
};

const WINNING_THRESHOLD = 150;
const ACCURACY_STREAK = 90;

// Calculate accuracy based on centipawn loss (0-100)
// Formula: 100 * exp(-0.002 * cpLoss)
const calculateAccuracy = (cpLoss) => {
    // Cap loss at 500 for calculation sanity
    const cappedLoss = Math.min(Math.abs(cpLoss), 1000);
    return Math.round(100 * Math.exp(-0.002 * cappedLoss));
};

const applyClassificationPenalty = (accuracy, classification) => {
    const penalties = {
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
    userMoveUCI,
    bestMoveUCI,
    scoreBefore,
    myScoreAfter,
    materialDelta
}) => {
    const isBest = userMoveUCI === bestMoveUCI;

    if (isBest) {
        const swing = myScoreAfter - scoreBefore;
        const winning = myScoreAfter >= 150;
        const sacrifice = materialDelta <= -3;

        if (sacrifice && winning) return 'brilliant';
        if (swing >= 120 || (scoreBefore > -50 && scoreBefore < 50 && myScoreAfter >= 150)) return 'great';
        return 'best';
    }

    if (evalDiff > THRESHOLDS.BLUNDER) return 'blunder';
    if (evalDiff > THRESHOLDS.MISTAKE) return 'mistake';
    if (evalDiff > THRESHOLDS.INACCURACY) return 'inaccuracy';
    if (evalDiff > THRESHOLDS.GOOD) return 'good';
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

const materialTotal = (fen) => {
    const score = materialScore(fen);
    return score.white + score.black;
};

const getGamePhase = (ply, material) => {
    if (ply <= 20) return 'opening';
    if (material <= 14) return 'endgame';
    return 'middlegame';
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
    materialDelta
}) => {
    const motifs = [];
    const board = chessAfter.board();

    if (detectFork(chessAfter, move)) motifs.push('fork');
    if (detectPin(chessAfter, move, board)) motifs.push('pin');
    if (detectSkewer(chessAfter, move, board)) motifs.push('skewer');
    if (materialDelta <= -3 && myScoreAfter - scoreBefore >= 50) motifs.push('sacrifice');

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
    if (classification === 'brilliant') return `Brilliant!! A difficult-to-find, winning sacrifice. ${move} is the engine's top choice.`;
    if (classification === 'great') return `Great! A critical, often only, good move. ${move} keeps you on track.`;
    if (classification === 'blunder') return `This move loses significant material or allows a mate. You played ${move}, but ${bestMove} was much better.`;
    if (classification === 'mistake') return `A mistake that gives away your advantage. ${bestMove} would have kept the position equal or better.`;
    if (classification === 'inaccuracy') return `A slightly passive move. ${bestMove} was more precise.`;
    if (classification === 'best') return `Best move. ${move} is the highest-engine-rated choice.`;
    if (classification === 'good') return `Good move. Solid and correct, though not the very best.`;
    return `Analysis: CP Loss ${Math.round(evalDiff)}`;
};

export const processGame = async (gameId) => {
    const game = await db.games.get(gameId);
    if (!game || game.analyzed) return; // Skip if already analyzed

    const heroUser = (localStorage.getItem('heroUser') || '').toLowerCase();
    const heroInGame = heroUser && (game.white?.toLowerCase() === heroUser || game.black?.toLowerCase() === heroUser);
    if (!heroInGame) {
        await db.games.update(gameId, { analyzed: false, analysisStatus: 'ignored' });
        return;
    }

    if (!game.pgn || typeof game.pgn !== 'string') {
        console.warn(`Skipping analysis for game ${gameId}: Missing or invalid PGN.`);
        await db.games.update(gameId, { analyzed: true });
        return;
    }

    await db.games.update(gameId, { analysisStatus: 'analyzing', analysisStartedAt: new Date().toISOString() });
    await db.positions.where('gameId').equals(gameId).delete();

    const chess = new Chess();
    try {
        chess.loadPgn(game.pgn);
    } catch (e) {
        console.error(`Invalid PGN parsing for game ${gameId}`, e);
        await db.games.update(gameId, { analyzed: true, analysisStatus: 'failed' });
        return;
    }

    const history = chess.history({ verbose: true });
    chess.reset();

    const analysisLog = [];
    const reelPositions = [];
    let whiteAccuracySum = 0;
    let whiteMoves = 0;
    let blackAccuracySum = 0;
    let blackMoves = 0;
    let currentStreak = 0;
    let maxStreak = 0;
    let totalCpLoss = 0;
    let maxEvalSwing = 0;
    let prevScore = 0;

    let bookMoves = [];
    try {
        if (game.eco) {
            const opening = await db.openings.get(game.eco);
            if (opening?.masterMoves?.length) bookMoves = opening.masterMoves;
        }
    } catch (e) {
        console.warn("Failed to load opening book moves", e);
    }

    const depthSetting = parseInt(localStorage.getItem('engineDepth') || '15', 10);
    const depth = Number.isNaN(depthSetting) ? 15 : depthSetting;
    const shallowDepth = Math.max(8, depth - 4);

    try {
        for (let i = 0; i < history.length; i++) {
            const move = history[i];
            const fenBefore = chess.fen();
            const sideToMove = chess.turn(); // 'w' or 'b'
            const ply = i + 1;

            // 1. Analyze position BEFORE the move
            const result = await engine.analyze(fenBefore, depth);
            const bestMoveUCI = result.bestMove;
            const evaluation = result.evaluation; // { score, mate }
            const scoreBefore = evaluation.score || 0;

            // 2. Identify User's Move
            const userMoveUCI = move.from + move.to + (move.promotion || '');

            let classification = 'book';
            let evalDiff = 0;
            let myScoreAfter = scoreBefore;
            let materialDelta = 0;

            // 3. Evaluate after move (for all moves)
            chess.move(move);
            const fenAfter = chess.fen();
            const resultAfter = await engine.analyze(fenAfter, shallowDepth);
            const chessAfter = new Chess(fenAfter);
            chess.undo();

            const scoreAfter = resultAfter.evaluation.score || 0;
            // scoreAfter is from Opponent's perspective.
            myScoreAfter = -scoreAfter;

            const beforeMaterial = materialScore(fenBefore);
            const afterMaterial = materialScore(fenAfter);
            if (sideToMove === 'w') {
                materialDelta = afterMaterial.white - beforeMaterial.white;
            } else {
                materialDelta = afterMaterial.black - beforeMaterial.black;
            }

            // CP Loss
            evalDiff = Math.max(0, scoreBefore - myScoreAfter);
            classification = getClassification({
                evalDiff,
                userMoveUCI,
                bestMoveUCI,
                scoreBefore,
                myScoreAfter,
                materialDelta
            });

            const phase = getGamePhase(ply, materialTotal(fenBefore));
            const motifs = detectMotifs({
                chessAfter,
                move,
                scoreBefore,
                myScoreAfter,
                materialDelta
            });

            const missedWin = scoreBefore >= WINNING_THRESHOLD && evalDiff > THRESHOLDS.INACCURACY;
            const missedDefense = scoreBefore <= -WINNING_THRESHOLD && evalDiff > THRESHOLDS.INACCURACY;

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

            maxEvalSwing = Math.max(maxEvalSwing, Math.abs(scoreBefore - prevScore));
            prevScore = scoreBefore;

            // Log Data (for Analytics Panel)
            const isBookMove = phase === 'opening' && bookMoves.includes(bestMoveUCI);

            analysisLog.push({
                ply,
                fen: fenBefore,
                move: userMoveUCI,
                bestMove: bestMoveUCI,
                score: scoreBefore, // Evaluation *before* the move (graph point)
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

            const tags = [
                classification,
                phase,
                ...motifs
            ];
            if (isBookMove) tags.push('book');
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
                    score: scoreBefore,
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
        await db.games.update(gameId, { analyzed: true, analysisStatus: 'failed', analysisStartedAt: null });
        return;
    }

    // Save Reel Positions
    if (reelPositions.length > 0) {
        await db.positions.bulkAdd(reelPositions);
    }

    // Save Game Analytics
    await db.games.update(gameId, {
        analyzed: true,
        analysisStatus: 'completed',
        analysisStartedAt: null,
        analyzedAt: new Date().toISOString(),
        analysisLog, // Full history for graph
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
