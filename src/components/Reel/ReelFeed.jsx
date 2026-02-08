import React, { useState, useEffect, useMemo, useRef, useLayoutEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../services/db';
import { Chessboard } from 'react-chessboard';
import { ArrowRight, Eye, CheckCircle, XCircle, Bookmark } from 'lucide-react';
import { Chess } from 'chess.js';
import { useNavigate } from 'react-router-dom';

const MOVE_BADGE_MAP = {
    brilliant: { label: '!!', tone: 'brilliant' },
    great: { label: '!', tone: 'great' },
    best: { label: '★', tone: 'best' },
    good: { label: '✓', tone: 'good' },
    inaccuracy: { label: '?!', tone: 'inaccuracy' },
    mistake: { label: '?', tone: 'mistake' },
    blunder: { label: '??', tone: 'blunder' }
};

const getMoveBadge = (classification) => {
    if (!classification) return null;
    return MOVE_BADGE_MAP[classification] || null;
};

const ReelCard = ({ position, onNext, mode = 'best_move', onSolved, onContinueLine }) => {
    const BADGE_SIZE = 26;
    const BADGE_INSET = 2;
    const PIECE_ANIMATION_MS = 300;

    const [showSolution, setShowSolution] = useState(false);
    const [game, setGame] = useState(null);
    const [feedback, setFeedback] = useState(null);
    const boardRef = useRef(null);
    const [boardSize, setBoardSize] = useState(360);
    const [tempFen, setTempFen] = useState(null);
    const [lastAttempt, setLastAttempt] = useState(null);
    const [stage, setStage] = useState('puzzle'); // intro | puzzle | solved
    const [attemptLocked, setAttemptLocked] = useState(false);
    const resetTimerRef = useRef(null);
    const introTimerRef = useRef(null);
    const messageTimerRef = useRef(null);
    const badgeTimerRef = useRef(null);
    const [badgesReady, setBadgesReady] = useState(true);
    const [blunderBadgeStyle, setBlunderBadgeStyle] = useState(null);
    const [solutionBadgeStyle, setSolutionBadgeStyle] = useState(null);
    // (Explore mode removed) - continue lines open in Dashboard now.

    useEffect(() => {
        db.games.get(position.gameId).then(setGame);
        setShowSolution(false);
        setFeedback(null);
        setTempFen(null);
        setLastAttempt(null);
        setStage('puzzle');
        setAttemptLocked(false);
        setBadgesReady(false);
        setBlunderBadgeStyle(null);
        setSolutionBadgeStyle(null);
        if (resetTimerRef.current) {
            clearTimeout(resetTimerRef.current);
            resetTimerRef.current = null;
        }
        if (introTimerRef.current) {
            clearTimeout(introTimerRef.current);
            introTimerRef.current = null;
        }
        if (messageTimerRef.current) {
            clearTimeout(messageTimerRef.current);
            messageTimerRef.current = null;
        }
        if (badgeTimerRef.current) {
            clearTimeout(badgeTimerRef.current);
            badgeTimerRef.current = null;
        }
    }, [position.id]);

    useEffect(() => {
        if (!boardRef.current) return;
        const resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                if (entry.contentRect) {
                    const width = Math.floor(entry.contentRect.width);
                    if (width > 0) setBoardSize(width);
                }
            }
        });
        resizeObserver.observe(boardRef.current);
        return () => resizeObserver.disconnect();
    }, [position.id]);

    const computeBadgeStyle = (square) => {
        if (!square) return null;

        const root = boardRef.current;
        if (root) {
            // react-chessboard squares usually expose `data-square="<sq>"`
            const el = root.querySelector(`[data-square="${square}"]`);
            if (el) {
                const rootRect = root.getBoundingClientRect();
                const rect = el.getBoundingClientRect();
                return {
                    left: Math.round(rect.left - rootRect.left + rect.width - BADGE_SIZE + BADGE_INSET),
                    top: Math.round(rect.top - rootRect.top + BADGE_INSET)
                };
            }
        }

        // Fallback: math-based placement (square top-right, orientation aware)
        const file = square.charCodeAt(0) - 97;
        const rank = parseInt(square[1], 10) - 1;
        if (Number.isNaN(file) || Number.isNaN(rank)) return null;
        const size = boardSize / 8;
        let x = file;
        let y = 7 - rank;
        if (!isHeroWhite) {
            x = 7 - file;
            y = rank;
        }
        return {
            left: Math.round(x * size + size - BADGE_SIZE + BADGE_INSET),
            top: Math.round(y * size + BADGE_INSET)
        };
    };

    const onDrop = (...args) => {
        console.log("[ReelFeed] onDrop args:", args);
        let sourceSquare = args[0];
        let targetSquare = args[1];

        if (showSolution || stage !== 'puzzle' || attemptLocked) return false;

        if (typeof sourceSquare === 'object') {
            console.log("[ReelFeed] onDrop received object signature?", sourceSquare);
            if (sourceSquare.sourceSquare && sourceSquare.targetSquare) {
                const obj = sourceSquare;
                sourceSquare = obj.sourceSquare;
                targetSquare = obj.targetSquare;
            }
        }
        if (typeof sourceSquare !== 'string' || typeof targetSquare !== 'string') return false;
        if (sourceSquare === targetSquare) return false;

        if (!puzzleFen) return false;
        const base = new Chess(puzzleFen);
        const piece = base.get(sourceSquare);
        const targetRank = targetSquare[1];
        const needsPromotion = piece && piece.type === 'p' && (targetRank === '1' || targetRank === '8');

        let moveResult = null;
        try {
            moveResult = base.move({
                from: sourceSquare,
                to: targetSquare,
                promotion: needsPromotion ? 'q' : undefined
            });
        } catch (e) {
            console.error("Invalid move", e);
            return false;
        }
        if (!moveResult) return false;

        const attemptUCI = (moveResult.from + moveResult.to + (moveResult.promotion || '')).toLowerCase();

        const targetFull = (targetMove || position.bestMove || '').trim().toLowerCase();
        const targetUCI = targetFull.substring(0, 4);

        if (moveResult) {
            setTempFen(base.fen());
            setLastAttempt({ san: moveResult.san, uci: attemptUCI });
        }
        setAttemptLocked(true);

        const shouldReset = true;

        const isCorrect = targetFull.length >= 4 && (targetFull.length > 4
            ? attemptUCI === targetFull || attemptUCI === targetUCI + 'q'
            : attemptUCI.substring(0, 4) === targetUCI);

        if (isCorrect) {

            setFeedback('correct');
            setShowSolution(true);
            setStage('solved');
            // Keep the piece on the board and show the move
            setTempFen(base.fen());
            setLastAttempt({ san: moveResult.san, uci: attemptUCI });

            if (onSolved) onSolved(true);
            return true;
        } else {
            // Wrong move: Show for a bit, then reset
            if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
            if (messageTimerRef.current) clearTimeout(messageTimerRef.current);

            // 1. Show the wrong move immediately (already done by returning true + tempFen set above)

            // 2. Wait, then reset board and show feedback
            resetTimerRef.current = setTimeout(() => {
                if (shouldReset) {
                    setTempFen(null); // Clear the wrong move from board
                    setLastAttempt(null); // Clear the move notation
                }
                setFeedback('incorrect');
                setAttemptLocked(false);

                // 3. Clear feedback message after a delay
                messageTimerRef.current = setTimeout(() => {
                    setFeedback(null);
                }, 2000);
            }, 800); // 800ms of showing the wrong move

            if (onSolved) onSolved(false);
            return true;
        }
    };

    const heroUser = localStorage.getItem('heroUser') || 'Hero';
    const getName = (player) => {
        if (!player) return 'Unknown';
        if (typeof player === 'string') return player;
        return player.name || 'Unknown';
    };
    const getRating = (player, fallback) => {
        if (typeof fallback === 'number' || typeof fallback === 'string') return fallback;
        if (player && typeof player === 'object' && player.rating) return player.rating;
        return '?';
    };
    const isHeroWhite = game ? getName(game.white).toLowerCase() === heroUser.toLowerCase() : true;

    // Determine Top (Opponent) vs Bottom (Hero)
    const topPlayer = isHeroWhite ?
        { name: getName(game?.black) || 'Opponent', rating: getRating(game?.black, game?.blackRating) } :
        { name: getName(game?.white) || 'Opponent', rating: getRating(game?.white, game?.whiteRating) };

    const bottomPlayer = isHeroWhite ?
        { name: getName(game?.white) || heroUser, rating: getRating(game?.white, game?.whiteRating) } :
        { name: getName(game?.black) || heroUser, rating: getRating(game?.black, game?.blackRating) };

    const isReview = useMemo(() => {
        return position?.nextReviewAt && new Date(position.nextReviewAt) <= new Date();
    }, [position?.nextReviewAt]);

    const toggleReview = async () => {
        if (!position?.id) return;
        const newReviewAt = isReview ? null : new Date().toISOString();
        await db.positions.update(position.id, { nextReviewAt: newReviewAt });
    };

    const blunderInfo = useMemo(() => {
        if (!game?.pgn || !position?.ply) return null;
        try {
            const chess = new Chess();
            chess.loadPgn(game.pgn);
            const moves = chess.history({ verbose: true });
            const entry = moves[position.ply - 1];
            if (!entry) return null;
            return {
                ply: position.ply,
                san: entry.san,
                uci: `${entry.from}${entry.to}${entry.promotion || ''}`,
                from: entry.from,
                to: entry.to
            };
        } catch (e) {
            return null;
        }
    }, [game?.pgn, position?.ply]);

    const moveLabel = useMemo(() => {
        if (!blunderInfo) return null;
        const num = Math.ceil(blunderInfo.ply / 2);
        const suffix = blunderInfo.ply % 2 === 0 ? '...' : '.';
        return `${num}${suffix} ${blunderInfo.san}`;
    }, [blunderInfo]);

    const classificationBadge = useMemo(() => getMoveBadge(position?.classification), [position?.classification]);

    const solutionBadge = useMemo(() => {
        if (!position?.classification) return { label: '★', tone: 'best' };
        const positive = ['brilliant', 'great', 'best', 'good'];
        if (positive.includes(position.classification)) return getMoveBadge(position.classification);
        return { label: '★', tone: 'best' };
    }, [position?.classification]);

    const heroMoved = useMemo(() => {
        return (position.turn === 'w' && isHeroWhite) || (position.turn === 'b' && !isHeroWhite);
    }, [position.turn, isHeroWhite]);

    const blunderFen = useMemo(() => {
        try {
            if (!position?.fen || !position?.move) return position?.fen || '';
            const chess = new Chess(position.fen);
            const from = position.move.substring(0, 2);
            const to = position.move.substring(2, 4);
            const promo = position.move.length > 4 ? position.move.substring(4, 5) : undefined;
            chess.move({ from, to, promotion: promo });
            return chess.fen();
        } catch (e) {
            return position?.fen || '';
        }
    }, [position?.fen, position?.move]);

    const puzzleFen = useMemo(() => {
        // If Hero blundered: We solve from BEFORE the blunder (position.fen)
        // If Opponent blundered: We solve from AFTER the blunder (blunderFen) to punish it
        return heroMoved ? (position?.fen || '') : (blunderFen || position?.fen || '');
    }, [heroMoved, blunderFen, position?.fen]);

    const targetMove = useMemo(() => {
        if (!game?.analysisLog || !position?.ply) return position.bestMove;

        // If it's our blunder (heroMoved), we are looking for the best move from the *original* position
        // This is stored in position.bestMove (engine analyzed the pre-move position)
        if (heroMoved) {
            return position.bestMove;
        }

        // If it's opponent's blunder (!heroMoved), we are looking for the move that *punishes* it.
        // This corresponds to the *next* ply in the game... BUT wait. 
        // The game analysis log stores "bestMove" for the position *before* the move at that ply.
        // So for ply X (opponent move), we want the best move for ply X+1 (our response).
        const nextEntry = game.analysisLog.find((e) => e.ply === position.ply + 1);
        if (nextEntry) return nextEntry.bestMove;

        // Fallback: If we don't have next entry (e.g. end of game), we might need to rely on engine
        // or just use what we have if it makes sense. 
        // For now, let's trust position.bestMove if we can't find next entry, 
        // though position.bestMove is usually for the position at `ply`.
        return position.bestMove;
    }, [game?.analysisLog, position?.ply, heroMoved, position?.bestMove]);

    const displayFen = useMemo(() => {
        if (stage === 'intro') return blunderFen; // Always show the blunder being played/played
        if (tempFen) return tempFen; // Shows user's attempt (correct or wrong)
        return puzzleFen; // Default start state for puzzle
    }, [stage, blunderFen, tempFen, puzzleFen]);

    const solutionSquare = useMemo(() => {
        if (!targetMove || targetMove.length < 4) return null;
        return targetMove.substring(2, 4);
    }, [targetMove]);

    useEffect(() => {
        if (!heroMoved) {
            setStage('puzzle');
            setAttemptLocked(false);
            return;
        }
        setStage('intro');
        setAttemptLocked(false);
        introTimerRef.current = setTimeout(() => {
            setStage('puzzle');
            setAttemptLocked(false);
        }, 1200);
        return () => {
            if (introTimerRef.current) clearTimeout(introTimerRef.current);
        };
    }, [heroMoved, position?.id]);

    // Delay badge render until piece animation likely finished
    useEffect(() => {
        setBadgesReady(false);
        if (badgeTimerRef.current) clearTimeout(badgeTimerRef.current);
        badgeTimerRef.current = setTimeout(() => setBadgesReady(true), PIECE_ANIMATION_MS + 60);
        return () => {
            if (badgeTimerRef.current) clearTimeout(badgeTimerRef.current);
        };
    }, [displayFen, stage, tempFen]);

    // Recompute badge positions after the board has rendered and the piece animation settles.
    useLayoutEffect(() => {
        if (!badgesReady) return;

        const wantBlunderSquare = (stage === 'intro' || !heroMoved) ? blunderInfo?.to : null;
        const wantSolutionSquare = showSolution ? solutionSquare : null;

        setBlunderBadgeStyle(computeBadgeStyle(wantBlunderSquare));
        setSolutionBadgeStyle(computeBadgeStyle(wantSolutionSquare));
    }, [
        badgesReady,
        boardSize,
        isHeroWhite,
        stage,
        heroMoved,
        blunderInfo?.to,
        showSolution,
        solutionSquare
    ]);

    // When user reveals solution, show the best move on the board.
    useEffect(() => {
        if (!showSolution) {
            setTempFen(null);
            return;
        }
        if (!puzzleFen || !targetMove || targetMove.length < 4) return;
        try {
            const chess = new Chess(puzzleFen);
            const from = targetMove.substring(0, 2);
            const to = targetMove.substring(2, 4);
            const promotion = targetMove.length > 4 ? targetMove.substring(4, 5) : undefined;
            const move = chess.move({ from, to, promotion });
            if (move) {
                setTempFen(chess.fen());
            }
        } catch (e) {
            console.error("Failed to apply solution move", e);
        }
    }, [showSolution, puzzleFen, targetMove]);

    if (!game) return <div className="h-full flex items-center justify-center text-muted">Loading context...</div>;

    const promptText = () => {
        if (!heroMoved) {
            const type = position.classification || 'move';
            // Simple check for "an" vs "a"
            const article = ['inaccuracy'].includes(type) ? 'an' : 'a';
            return `Punish the ${type}`;
        }
        if (mode === 'why_blunder') return 'Why is this a blunder?';
        if (mode === 'find_brilliant') return 'Find the brilliant idea';
        if (mode === 'find_defense') return 'Find the best defense';
        if (mode === 'convert_win') return 'Convert your advantage';
        return 'Find the best move';
    };



    return (
        <div className="w-full h-full flex flex-col items-center justify-center relative p-6" style={{ scrollSnapAlign: 'start' }}>

            <div className="bg-panel border rounded-xl shadow-lg p-6 w-full relative" style={{ maxWidth: 600 }}>

                {/* Top Meta: Classification + Game Info + Eval */}
                <div className="reel-header mb-4">
                    <div className="reel-header__center">
                        <div className="reel-header__line1">
                            <span className={`reel-quality__dot ${position.classification === 'blunder' ? 'reel-dot--red' : 'reel-dot--orange'}`} />
                            <span className="reel-quality__text">{position.classification || 'position'}</span>
                            {moveLabel && (
                                <>
                                    <span className="reel-header__sep">•</span>
                                    <span className="reel-header__move">{moveLabel}</span>
                                </>
                            )}
                        </div>
                        <div className="reel-header__line2">
                            <span className="reel-meta__perf">{(game.perf || 'Standard').toLowerCase()}</span>
                            <span className="reel-header__sep">•</span>
                            <span className="reel-meta__date">
                                {new Date(game.date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' })}
                            </span>
                        </div>
                    </div>
                    <div
                        className={`reel-eval-pill ${String(position.score || '').startsWith('+') ? 'reel-eval--good' : String(position.score || '').startsWith('-') ? 'reel-eval--bad' : ''}`}
                        title="Engine evaluation for this position (White perspective)"
                    >
                        <span className="reel-eval-pill__k">Eval</span>
                        <span className="reel-eval-pill__v">{position.score}</span>
                    </div>
                </div>

                {/* Opponent (Top) */}
                <div className="flex justify-between items-end px-1 mb-1">
                    <div className="flex items-baseline gap-2 text-secondary">
                        <span className="font-semibold">{topPlayer.name}</span>
                        <span className="text-sm font-light">({topPlayer.rating})</span>
                    </div>
                </div>

                {/* Board */}
                <div className="w-full rounded overflow-hidden mb-2 border bg-subtle relative">
                    <div style={{ paddingBottom: '100%' }}></div>
                    <div className="absolute inset-0" ref={boardRef}>
                        <Chessboard
                            options={{
                                position: displayFen,
                                boardWidth: boardSize,
                                arePiecesDraggable: !showSolution && stage === 'puzzle',
                                onPieceDrop: onDrop,
                                boardOrientation: isHeroWhite ? 'white' : 'black',
                                animationDuration: PIECE_ANIMATION_MS,
                                customDarkSquareStyle: { backgroundColor: '#71717a' },
                                customLightSquareStyle: { backgroundColor: '#e4e4e7' }
                            }}
                        />
                        {badgesReady && classificationBadge && blunderBadgeStyle && (stage === 'intro' || !heroMoved) && (
                            <div
                                className={`board-badge badge-${classificationBadge.tone}`}
                                style={{ left: blunderBadgeStyle.left, top: blunderBadgeStyle.top }}
                            >
                                {classificationBadge.label}
                            </div>
                        )}
                        {badgesReady && showSolution && solutionBadge && solutionBadgeStyle && (
                            <div
                                className={`board-badge badge-${solutionBadge.tone}`}
                                style={{ left: solutionBadgeStyle.left, top: solutionBadgeStyle.top }}
                            >
                                {solutionBadge.label}
                            </div>
                        )}
                    </div>

                    {/* Feedback Overlay */}
                    {feedback === 'incorrect' && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-10 animate-fade-in">
                            <XCircle size={64} className="text-red-500" />
                        </div>
                    )}
                    {feedback === 'correct' && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-10 animate-fade-in">
                            <CheckCircle size={64} className="text-green-500" />
                        </div>
                    )}
                </div>

                <div className="flex justify-between items-start px-1 mb-4">
                    <div className="flex items-baseline gap-2 text-primary">
                        <span className="font-bold text-lg">{bottomPlayer.name}</span>
                        <span className="text-sm font-light">({bottomPlayer.rating})</span>
                    </div>
                    <button
                        onClick={toggleReview}
                        className={`p-2 rounded-full transition-colors ${isReview ? 'text-indigo-500 bg-indigo-500/10' : 'text-muted hover:text-secondary'}`}
                        title={isReview ? "Remove from Review" : "Mark for Review"}
                    >
                        <Bookmark size={20} fill={isReview ? "currentColor" : "none"} />
                    </button>
                </div>

                {/* Context / Feedback Area */}
                <div className="mb-6 text-center min-h-[60px] flex items-center justify-center">
                    {showSolution ? (
                        <div className="w-full animate-fade-in">
                            <div className="p-2 rounded bg-subtle text-green-400 flex items-center justify-center gap-2 text-sm font-medium w-full mb-2">
                                <CheckCircle size={16} /> Best Move: {targetMove || position.bestMove}
                            </div>
                            {blunderInfo && (
                                <div className="text-xs text-secondary mb-2">
                                    Played: {blunderInfo.san} ({blunderInfo.uci})
                                </div>
                            )}
                            {lastAttempt && (
                                <div className="text-xs text-secondary mb-2">
                                    Your move: {lastAttempt.san} ({lastAttempt.uci})
                                </div>
                            )}
                            <p className="text-xs text-muted leading-relaxed">
                                {position.explanation || "No explanation available."}
                            </p>
                            {position.planHint && (
                                <div className="mt-3 text-xs text-secondary">
                                    Plan: {position.planHint}
                                </div>
                            )}
                            {position.motifs?.length > 0 && (
                                <div className="mt-2 flex flex-wrap justify-center gap-2">
                                    {position.motifs.map((motif) => (
                                        <span key={motif} className="pill">{motif}</span>
                                    ))}
                                </div>
                            )}
                        </div>
                    ) : stage === 'intro' && heroMoved ? (
                        <div className="flex flex-col items-center gap-1 text-xs text-muted">
                            Showing the blunder...
                        </div>
                    ) : (
                        <div className="flex flex-col items-center gap-1 animate-pulse">
                            <span className="text-primary font-medium text-sm">{promptText()}</span>
                            <span className="text-xs text-muted"> <strong>Your Turn</strong>
                            </span>
                            {feedback === 'incorrect' && (
                                <div className="text-xs text-red-400 mt-2">
                                    {lastAttempt ? `You played ${lastAttempt.san}. Try again.` : 'Not the best move. Try again.'}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Actions */}
                <div className="flex gap-3">
                    <button
                        onClick={() => setShowSolution(!showSolution)}
                        className="flex-1 btn btn-secondary py-3 justify-center"
                    >
                        <Eye size={18} className="mr-2" />
                        {showSolution ? 'Hide' : 'Solution'}
                    </button>
                    {showSolution && (
                        <button
                            onClick={() => {
                                const startIndex = heroMoved ? position.ply - 2 : position.ply - 1;
                                const moveIndex = Math.max(-1, Number.isFinite(startIndex) ? startIndex : -1);
                                onContinueLine && onContinueLine({ gameId: position.gameId, moveIndex });
                            }}
                            className="flex-1 btn btn-secondary py-3 justify-center"
                        >
                            Continue in Dashboard
                        </button>
                    )}
                    <button
                        onClick={onNext}
                        className="flex-1 btn btn-primary py-3 justify-center"
                    >
                        Next <ArrowRight size={18} className="ml-2" />
                    </button>
                </div>

            </div>

        </div>
    );
};

export const ReelFeed = () => {
    const heroUser = localStorage.getItem('heroUser');
    const navigate = useNavigate();
    const [solvedInSession, setSolvedInSession] = useState([]);

    // Complex query: Join positions with games to filter by Hero's turn
    const positions = useLiveQuery(async () => {
        if (!heroUser) return { stale: [], recent: [] };

        // 1. Get all critical positions
        const candidates = await db.positions
            .where('classification').anyOf(['blunder', 'mistake', 'brilliant', 'great', 'miss', 'inaccuracy'])
            .limit(300)
            .toArray();

        const uniqueGameIds = [...new Set(candidates.map((pos) => pos.gameId))];
        const games = await db.games.bulkGet(uniqueGameIds);
        const gameMap = new Map();
        games.forEach((game) => {
            if (game) gameMap.set(game.id, game);
        });

        const validPositions = [];

        for (const pos of candidates) {
            const game = gameMap.get(pos.gameId);
            if (!game) continue;

            const gameWhite = typeof game.white === 'string' ? game.white : game.white?.name || '';
            const gameBlack = typeof game.black === 'string' ? game.black : game.black?.name || '';
            const isHeroWhite = gameWhite.toLowerCase() === heroUser.toLowerCase();
            const isHeroBlack = gameBlack.toLowerCase() === heroUser.toLowerCase();

            if (isHeroWhite || isHeroBlack) {
                validPositions.push({ ...pos, _game: game });
            }
        }

        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 14);

        const solved = [];
        const unsolved = [];
        const review = [];

        const now = new Date();
        validPositions.forEach((pos) => {
            // Review: Based on nextReviewAt
            if (pos.nextReviewAt && new Date(pos.nextReviewAt) <= now) {
                review.push(pos);
            }

            // Solved vs Unsolved
            if (pos.solveStatus === 'correct') {
                solved.push(pos);
                // Also keep in unsolved if it was solved in this session
                if (solvedInSession.includes(pos.id)) {
                    unsolved.push(pos);
                }
            } else {
                unsolved.push(pos);
            }
        });

        const sortByGameDate = (a, b) => new Date(b._game.date || 0) - new Date(a._game.date || 0);
        solved.sort(sortByGameDate);
        unsolved.sort(sortByGameDate);
        review.sort(sortByGameDate);

        return {
            solved: solved.slice(0, 50),
            unsolved: unsolved.slice(0, 50),
            review: review.slice(0, 50)
        };
    }, [heroUser, solvedInSession]);

    const [section, setSection] = useState('unsolved');
    const [mode, setMode] = useState('best_move');
    const [index, setIndex] = useState(0);
    const [quizActive, setQuizActive] = useState(false);
    const [quizScore, setQuizScore] = useState(0);
    const [quizIndex, setQuizIndex] = useState(0);
    const [quizSet, setQuizSet] = useState([]);


    useEffect(() => {
        if (!positions) return;
        if (!quizActive) return;
        if (quizSet.length === 0) {
            const pool = [...positions.review, ...positions.unsolved, ...positions.solved];
            const unique = Array.from(new Set(pool.map((pos) => pos.id))).map(id => pool.find(p => p.id === id));
            setQuizSet(unique.slice(0, 5));
            setQuizIndex(0);
            setQuizScore(0);
        }
    }, [quizActive, positions, quizSet.length]);

    if (!positions || (positions.unsolved.length === 0 && positions.solved.length === 0 && positions.review.length === 0)) return (
        <div className="h-full flex flex-col items-center justify-center text-muted p-8 text-center">
            <div className="p-4 rounded-full bg-subtle mb-4">
                <CheckCircle size={32} />
            </div>
            <p className="text-lg text-primary mb-2">No mistakes found yet!</p>
            <p className="text-sm">Import games and wait for the analyzer to process them.</p>
        </div>
    );

    const activePositions = section === 'unsolved' ? positions.unsolved : section === 'review' ? positions.review : positions.solved;
    const filteredPositions = activePositions.filter((pos) => {
        if (mode === 'best_move') return !['brilliant', 'great'].includes(pos.classification); // Focus on mistakes
        if (mode === 'why_blunder') return ['blunder'].includes(pos.classification);
        if (mode === 'find_brilliant') return ['brilliant', 'great'].includes(pos.classification);
        if (mode === 'find_defense') return pos.missedDefense;
        if (mode === 'convert_win') return pos.missedWin || pos.classification === 'miss';
        return true;
    });

    const activeSet = filteredPositions;
    const handleNext = () => setIndex(prev => (prev + 1) % activeSet.length);

    const scheduleReview = async (pos, correct) => {
        if (!pos?.id) return;
        const days = correct ? 7 : 1;
        const next = new Date();
        next.setDate(next.getDate() + days);
        if (correct) {
            setSolvedInSession(prev => [...prev, pos.id]);
        }
        await db.positions.update(pos.id, {
            nextReviewAt: next.toISOString(),
            lastReviewedAt: new Date().toISOString(),
            lastSolvedAt: correct ? new Date().toISOString() : null,
            solveStatus: correct ? 'correct' : 'incorrect'
        });
    };

    const handleQuizSolved = (correct) => {
        if (!quizActive) return;
        if (correct) setQuizScore((s) => s + 1);
    };

    const openInDashboard = ({ gameId, moveIndex }) => {
        if (!gameId && gameId !== 0) return;
        localStorage.setItem('activeGameId', String(gameId));
        localStorage.setItem('activeGameJumpGameId', String(gameId));
        localStorage.setItem('activeGameJumpMoveIndex', String(typeof moveIndex === 'number' ? moveIndex : -1));
        window.dispatchEvent(new Event('activeGameChanged'));
        navigate('/');
    };

    return (
        <div className="h-full w-full bg-app flex overflow-hidden">
            {/* Main Content Area */}
            <div className="flex-1 h-full relative flex flex-col items-center justify-center overflow-y-auto" style={{ scrollSnapType: 'y mandatory' }}>
                {quizActive ? (
                    quizSet.length > 0 ? (
                        <div className="w-full h-full flex flex-col items-center justify-center relative p-6">
                            <div className="text-xs text-muted mb-2">Quiz {quizIndex + 1} / {quizSet.length} • Score {quizScore}</div>
                            <div className="w-full max-w-xl h-full flex flex-col justify-center">
                                <ReelCard
                                    position={quizSet[quizIndex]}
                                    mode={quizSet[quizIndex]?.questionType || 'best_move'}
                                    onNext={() => setQuizIndex((i) => Math.min(quizSet.length - 1, i + 1))}
                                    onSolved={(correct) => {
                                        handleQuizSolved(correct);
                                        scheduleReview(quizSet[quizIndex], correct);
                                    }}
                                    onContinueLine={openInDashboard}
                                />
                            </div>
                            {quizIndex === quizSet.length - 1 && (
                                <div className="absolute bottom-10 bg-panel border p-4 rounded shadow-lg text-center z-20">
                                    <div className="text-lg font-bold text-primary mb-1">Quiz Complete</div>
                                    <div className="text-sm text-secondary">Score: {quizScore}/{quizSet.length}</div>
                                    <button className="mt-2 btn btn-primary w-full" onClick={() => setQuizActive(false)}>Close</button>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="h-full flex flex-col items-center justify-center text-muted p-8 text-center">
                            <p>No quiz questions available.</p>
                            <button className="mt-4 btn btn-secondary" onClick={() => setQuizActive(false)}>Back</button>
                        </div>
                    )
                ) : (
                    activeSet.length > 0 ? (
                        <ReelCard
                            position={activeSet[index % activeSet.length]}
                            onNext={handleNext}
                            mode={mode}
                            onSolved={(correct) => scheduleReview(activeSet[index % activeSet.length], correct)}
                            onContinueLine={openInDashboard}
                        />
                    ) : (
                        <div className="h-full flex flex-col items-center justify-center text-muted p-8 text-center">
                            <div className="p-4 rounded-full bg-subtle mb-4">
                                <CheckCircle size={32} />
                            </div>

                            {/* Category Empty States */}
                            {activePositions.length === 0 && (
                                <>
                                    {section === 'unsolved' && (
                                        <>
                                            <p className="text-lg text-primary mb-2">Great job! You've cleared your inbox.</p>
                                            <p className="text-sm">Import more games to find new mistakes.</p>
                                        </>
                                    )}
                                    {section === 'solved' && (
                                        <>
                                            <p className="text-lg text-primary mb-2">No solved puzzles yet.</p>
                                            <p className="text-sm">Solve puzzles in the "Recent" tab to see them here.</p>
                                        </>
                                    )}
                                    {section === 'review' && (
                                        <>
                                            <p className="text-lg text-primary mb-2">No puzzles due for review.</p>
                                            <p className="text-sm">Check back later or mark puzzles for review manually.</p>
                                        </>
                                    )}
                                </>
                            )}

                            {/* Training Mode Empty States (Category has items, but filter matches none) */}
                            {activePositions.length > 0 && (
                                <>
                                    {mode === 'best_move' && (
                                        <>
                                            <p className="text-lg text-primary mb-2">No mistakes found here.</p>
                                            <p className="text-sm">Try finding brilliant moves or missed wins instead.</p>
                                        </>
                                    )}
                                    {mode === 'why_blunder' && (
                                        <>
                                            <p className="text-lg text-primary mb-2">No blunders found.</p>
                                            <p className="text-sm">You played accurately in this batch!</p>
                                        </>
                                    )}
                                    {mode === 'find_brilliant' && (
                                        <>
                                            <p className="text-lg text-primary mb-2">No brilliant moves found.</p>
                                            <p className="text-sm">Keep playing boldly to create brilliant moments!</p>
                                        </>
                                    )}
                                    {mode === 'find_defense' && (
                                        <>
                                            <p className="text-lg text-primary mb-2">No missed defenses.</p>
                                            <p className="text-sm">You defended well in these games.</p>
                                        </>
                                    )}
                                    {mode === 'convert_win' && (
                                        <>
                                            <p className="text-lg text-primary mb-2">No missed conversions.</p>
                                            <p className="text-sm">You converted your advantages cleanly!</p>
                                        </>
                                    )}
                                </>
                            )}
                        </div>
                    )
                )}
            </div>

            {/* Right Sidebar - Filters */}
            <div className="w-96 h-full border-l bg-panel p-6 hidden lg:flex flex-col overflow-y-auto">
                <div className="mb-4">
                    <h3 className="text-xs font-semibold text-muted uppercase tracking-wider mb-3">Feed Source</h3>
                    <div className="flex flex-col gap-2">
                        {[
                            { id: 'unsolved', label: 'Recent Puzzles', count: positions?.unsolved?.length },
                            { id: 'solved', label: 'Solved Puzzles', count: positions?.solved?.length },
                            { id: 'review', label: 'Review Puzzles', count: positions?.review?.length }
                        ].map(opt => (
                            <button
                                key={opt.id}
                                onClick={() => { setSection(opt.id); setIndex(0); }}
                                className={`flex items-center justify-between p-3 rounded-lg border transition-all ${section === opt.id
                                    ? 'bg-primary/10 border-primary/50 text-primary'
                                    : 'bg-subtle border-transparent hover:border-border text-secondary'}`}
                            >
                                <span className="font-medium text-sm">{opt.label}</span>
                                {opt.count !== undefined && <span className="text-xs bg-black/10 px-2 py-0.5 rounded-full">{opt.count}</span>}
                            </button>
                        ))}
                    </div>
                </div>



                <div className="border-t border-gray-700/50 my-6"></div>

                <div className="mb-4">
                    <h3 className="text-xs font-semibold text-muted uppercase tracking-wider mb-3">Training Mode</h3>
                    <div className="flex flex-col gap-2">
                        {[
                            {
                                id: 'best_move',
                                label: 'Best Move',
                                count: activePositions.filter(p => !['brilliant', 'great'].includes(p.classification)).length
                            },
                            {
                                id: 'why_blunder',
                                label: 'Why Blunder?',
                                count: activePositions.filter(p => ['blunder'].includes(p.classification)).length
                            },
                            {
                                id: 'find_brilliant',
                                label: 'Brilliant Moves',
                                count: activePositions.filter(p => ['brilliant', 'great'].includes(p.classification)).length
                            },
                            {
                                id: 'find_defense',
                                label: 'Best Defense',
                                count: activePositions.filter(p => p.missedDefense).length
                            },
                            {
                                id: 'convert_win',
                                label: 'Convert Win',
                                count: activePositions.filter(p => p.missedWin || p.classification === 'miss').length
                            }
                        ].map(opt => (
                            <button
                                key={opt.id}
                                onClick={() => setMode(opt.id)}
                                className={`flex items-center justify-between p-3 rounded-lg border transition-all ${mode === opt.id
                                    ? 'bg-primary/10 border-primary/50 text-primary'
                                    : 'bg-subtle border-transparent hover:border-border text-secondary'}`}
                            >
                                <span className="font-medium text-sm">{opt.label}</span>
                                <span className="text-xs bg-black/10 px-2 py-0.5 rounded-full">{opt.count}</span>
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        </div >
    );
};
