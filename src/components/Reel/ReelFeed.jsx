import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../services/db';
import { Chessboard } from 'react-chessboard';
import { ArrowRight, Eye, CheckCircle, XCircle, HelpCircle } from 'lucide-react';
import { Chess } from 'chess.js';

const ReelCard = ({ position, onNext, mode = 'best_move', onSolved }) => {
    const [showSolution, setShowSolution] = useState(false);
    const [game, setGame] = useState(null);
    const [userMove, setUserMove] = useState(null); // Track user attempt if we want interactivity
    const [feedback, setFeedback] = useState(null);
    const boardRef = useRef(null);
    const [boardSize, setBoardSize] = useState(360);
    const [exploreMode, setExploreMode] = useState(false);
    const [exploreFen, setExploreFen] = useState(null);
    const exploreRef = useRef(null);
    const [tempFen, setTempFen] = useState(null);
    const [lastAttempt, setLastAttempt] = useState(null);
    const [stage, setStage] = useState('puzzle'); // intro | puzzle | solved
    const [attemptLocked, setAttemptLocked] = useState(false);
    const resetTimerRef = useRef(null);
    const introTimerRef = useRef(null);
    const messageTimerRef = useRef(null);

    useEffect(() => {
        db.games.get(position.gameId).then(setGame);
        setShowSolution(false);
        setUserMove(null);
        setFeedback(null);
        setExploreMode(false);
        setExploreFen(null);
        exploreRef.current = null;
        setTempFen(null);
        setLastAttempt(null);
        setStage('puzzle');
        setAttemptLocked(false);
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

    const classificationBadge = useMemo(() => {
        if (!position?.classification) return null;
        const map = {
            brilliant: { label: '!!', tone: 'brilliant' },
            great: { label: '!', tone: 'great' },
            best: { label: '★', tone: 'best' },
            good: { label: '✓', tone: 'good' },
            inaccuracy: { label: '?!', tone: 'inaccuracy' },
            mistake: { label: '?', tone: 'mistake' },
            blunder: { label: '??', tone: 'blunder' }
        };
        return map[position.classification] || null;
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
        if (exploreMode) return exploreFen || puzzleFen;
        if (tempFen) return tempFen; // Shows user's attempt (correct or wrong)
        return puzzleFen; // Default start state for puzzle
    }, [stage, blunderFen, exploreMode, exploreFen, tempFen, puzzleFen]);

    const getSquarePosition = (square) => {
        if (!square) return null;
        const file = square.charCodeAt(0) - 97;
        const rank = parseInt(square[1], 10) - 1;
        const size = boardSize / 8;
        let x = file;
        let y = 7 - rank;
        if (!isHeroWhite) {
            x = 7 - file;
            y = rank;
        }
        return {
            left: Math.round(x * size + size - 18),
            top: Math.round(y * size + 4)
        };
    };

    const blunderBadgePos = useMemo(() => getSquarePosition(blunderInfo?.to), [blunderInfo?.to, boardSize, isHeroWhite]);
    const solveBadgePos = useMemo(() => {
        if (!lastAttempt?.uci) return null;
        return getSquarePosition(lastAttempt.uci.substring(2, 4));
    }, [lastAttempt?.uci, boardSize, isHeroWhite]);

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

    useEffect(() => {
        if (!exploreMode) return;
        try {
            const chess = new Chess();
            if (showSolution && displayFen) {
                chess.load(displayFen);
            } else if (game?.pgn && position?.ply) {
                chess.loadPgn(game.pgn);
                const moves = chess.history({ verbose: true });
                chess.reset();
                for (let i = 0; i < position.ply; i++) {
                    const m = moves[i];
                    if (!m) break;
                    chess.move({ from: m.from, to: m.to, promotion: m.promotion });
                }
            }
            exploreRef.current = chess;
            setExploreFen(chess.fen());
        } catch (e) {
            console.error("Explore mode init failed", e);
        }
    }, [exploreMode, game?.pgn, position?.ply, showSolution, displayFen]);

    const onExploreDrop = (sourceSquare, targetSquare) => {
        if (!exploreRef.current) return false;
        const move = exploreRef.current.move({
            from: sourceSquare,
            to: targetSquare,
            promotion: 'q'
        });
        if (move) {
            setExploreFen(exploreRef.current.fen());
            return true;
        }
        return false;
    };

    const handleExploreReset = () => {
        setExploreMode(false);
        setExploreFen(null);
        exploreRef.current = null;
    };

    if (!game) return <div className="h-full flex items-center justify-center text-muted">Loading context...</div>;

    const promptText = () => {
        if (!heroMoved) return 'Punish the blunder';
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
                <div className="flex justify-between items-start mb-4">
                    <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                            <span className={`w-2 h-2 rounded-full ${position.classification === 'blunder' ? 'bg-red-400' : 'bg-orange-400'}`} />
                            <span className="text-sm font-medium uppercase tracking-wide text-secondary">{position.classification}</span>
                        </div>
                        {blunderInfo && (
                            <div className="text-xs text-muted">
                                Move {Math.ceil(blunderInfo.ply / 2)}{blunderInfo.ply % 2 === 0 ? '...' : '.'} {blunderInfo.san}
                            </div>
                        )}
                        <div className="flex items-center gap-2 text-xs text-muted">
                            <span className="uppercase tracking-wider font-semibold">{game.perf || 'Standard'}</span>
                            <span>•</span>
                            <span>{new Date(game.date).toLocaleDateString()}</span>
                        </div>
                    </div>
                    <div className="text-right">
                        <span className={`font-mono text-xl font-bold ${position.score.toString().startsWith('+') ? 'text-green-400' : position.score.toString().startsWith('-') ? 'text-red-400' : 'text-primary'}`}>
                            {position.score}
                        </span>
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
                                arePiecesDraggable: exploreMode || (!showSolution && stage === 'puzzle'),
                                onPieceDrop: exploreMode ? onExploreDrop : onDrop,
                                boardOrientation: isHeroWhite ? 'white' : 'black',
                                customDarkSquareStyle: { backgroundColor: '#71717a' },
                                customLightSquareStyle: { backgroundColor: '#e4e4e7' }
                            }}
                        />
                        {classificationBadge && blunderBadgePos && (stage === 'intro' || !heroMoved) && (
                            <div
                                className={`board-badge badge-${classificationBadge.tone}`}
                                style={{ left: blunderBadgePos.left, top: blunderBadgePos.top }}
                            >
                                {classificationBadge.label}
                            </div>
                        )}
                        {showSolution && solveBadgePos && (
                            <div
                                className="board-badge badge-best"
                                style={{ left: solveBadgePos.left, top: solveBadgePos.top }}
                            >
                                ★
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

                {/* Hero (Bottom) */}
                <div className="flex justify-between items-start px-1 mb-4">
                    <div className="flex items-baseline gap-2 text-primary">
                        <span className="font-bold text-lg">{bottomPlayer.name}</span>
                        <span className="text-sm font-light">({bottomPlayer.rating})</span>
                    </div>
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
                            <span className="text-xs text-muted">
                                {position.turn === 'w' ? 'White to move' : 'Black to move'} • <strong>Your Turn</strong>
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
                    {showSolution && !exploreMode && (
                        <button
                            onClick={() => setExploreMode(true)}
                            className="flex-1 btn btn-secondary py-3 justify-center"
                        >
                            Continue Line
                        </button>
                    )}
                    {exploreMode && (
                        <button
                            onClick={handleExploreReset}
                            className="flex-1 btn btn-secondary py-3 justify-center"
                        >
                            Back to Puzzle
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

    // Complex query: Join positions with games to filter by Hero's turn
    const positions = useLiveQuery(async () => {
        if (!heroUser) return { stale: [], recent: [] };

        // 1. Get all critical positions
        const candidates = await db.positions
            .where('classification').anyOf(['blunder', 'mistake', 'inaccuracy', 'brilliant', 'great', 'best', 'good'])
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

        const stale = [];
        const recent = [];
        const due = [];

        const now = new Date();
        validPositions.forEach((pos) => {
            const analyzedAt = pos._game.analyzedAt ? new Date(pos._game.analyzedAt) : null;
            if (!analyzedAt || analyzedAt < cutoff) stale.push(pos);
            else recent.push(pos);

            if (pos.nextReviewAt && new Date(pos.nextReviewAt) <= now) {
                due.push(pos);
            }
        });

        const sortByGameDate = (a, b) => new Date(b._game.date || 0) - new Date(a._game.date || 0);
        stale.sort(sortByGameDate);
        recent.sort(sortByGameDate);

        return {
            stale: stale.slice(0, 50),
            recent: recent.slice(0, 50),
            due: due.slice(0, 50)
        };
    }, [heroUser]);

    const [section, setSection] = useState('stale');
    const [mode, setMode] = useState('best_move');
    const [index, setIndex] = useState(0);
    const [quizActive, setQuizActive] = useState(false);
    const [quizScore, setQuizScore] = useState(0);
    const [quizIndex, setQuizIndex] = useState(0);
    const [quizSet, setQuizSet] = useState([]);

    useEffect(() => {
        if (!positions) return;
        if (section === 'stale' && positions.stale.length === 0 && positions.recent.length > 0) {
            setSection('recent');
            setIndex(0);
        }
        if (section === 'recent' && positions.recent.length === 0 && positions.stale.length > 0) {
            setSection('stale');
            setIndex(0);
        }
        if (section === 'due' && positions.due.length === 0) {
            setSection('stale');
            setIndex(0);
        }
    }, [positions, section]);

    useEffect(() => {
        if (!positions) return;
        if (!quizActive) return;
        if (quizSet.length === 0) {
            const pool = [...positions.due, ...positions.stale, ...positions.recent];
            const unique = Array.from(new Set(pool.map((pos) => pos.id))).map(id => pool.find(p => p.id === id));
            setQuizSet(unique.slice(0, 5));
            setQuizIndex(0);
            setQuizScore(0);
        }
    }, [quizActive, positions, quizSet.length]);

    if (!positions || (positions.stale.length === 0 && positions.recent.length === 0 && positions.due.length === 0)) return (
        <div className="h-full flex flex-col items-center justify-center text-muted p-8 text-center">
            <div className="p-4 rounded-full bg-subtle mb-4">
                <CheckCircle size={32} />
            </div>
            <p className="text-lg text-primary mb-2">No mistakes found yet!</p>
            <p className="text-sm">Import games and wait for the analyzer to process them.</p>
        </div>
    );

    const activePositions = section === 'stale' ? positions.stale : section === 'due' ? positions.due : positions.recent;
    const filteredPositions = activePositions.filter((pos) => {
        if (mode === 'best_move') return true;
        if (mode === 'why_blunder') return ['blunder', 'mistake'].includes(pos.classification);
        if (mode === 'find_brilliant') return ['brilliant', 'great'].includes(pos.classification);
        if (mode === 'find_defense') return pos.missedDefense;
        if (mode === 'convert_win') return pos.missedWin;
        return true;
    });

    const activeSet = filteredPositions.length ? filteredPositions : activePositions;
    const handleNext = () => setIndex(prev => (prev + 1) % activeSet.length);

    const scheduleReview = async (pos, correct) => {
        if (!pos?.id) return;
        const days = correct ? 7 : 1;
        const next = new Date();
        next.setDate(next.getDate() + days);
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

    return (
        <div className="h-full w-full bg-app overflow-y-auto" style={{ scrollSnapType: 'y mandatory' }}>
            <div className="flex items-center justify-center gap-3 py-4">
                <button
                    className={`btn ${section === 'stale' ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => { setSection('stale'); setIndex(0); }}
                >
                    Older Puzzles
                </button>
                <button
                    className={`btn ${section === 'due' ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => { setSection('due'); setIndex(0); }}
                >
                    Review Due
                </button>
                <button
                    className={`btn ${section === 'recent' ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => { setSection('recent'); setIndex(0); }}
                >
                    Recent Puzzles
                </button>
            </div>
            <div className="flex items-center justify-center gap-2 pb-2">
                <button className={`btn ${mode === 'best_move' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setMode('best_move')}>Best Move</button>
                <button className={`btn ${mode === 'why_blunder' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setMode('why_blunder')}>Why Blunder</button>
                <button className={`btn ${mode === 'find_brilliant' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setMode('find_brilliant')}>Brilliant</button>
                <button className={`btn ${mode === 'find_defense' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setMode('find_defense')}>Defense</button>
                <button className={`btn ${mode === 'convert_win' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setMode('convert_win')}>Convert Win</button>
                <button className={`btn ${quizActive ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setQuizActive((v) => !v)}>Quiz</button>
            </div>

            {quizActive && quizSet.length > 0 ? (
                <div className="flex flex-col items-center gap-3">
                    <div className="text-xs text-muted">Quiz {quizIndex + 1} / {quizSet.length} • Score {quizScore}</div>
                    <ReelCard
                        position={quizSet[quizIndex]}
                        mode={quizSet[quizIndex]?.questionType || 'best_move'}
                        onNext={() => setQuizIndex((i) => Math.min(quizSet.length - 1, i + 1))}
                        onSolved={(correct) => {
                            handleQuizSolved(correct);
                            scheduleReview(quizSet[quizIndex], correct);
                        }}
                    />
                    {quizIndex === quizSet.length - 1 && (
                        <div className="text-sm text-secondary">Quiz complete. Score {quizScore}/{quizSet.length}.</div>
                    )}
                </div>
            ) : activeSet.length > 0 ? (
                <ReelCard
                    position={activeSet[index % activeSet.length]}
                    onNext={handleNext}
                    mode={mode}
                    onSolved={(correct) => scheduleReview(activeSet[index % activeSet.length], correct)}
                />
            ) : (
                <div className="h-full flex flex-col items-center justify-center text-muted p-8 text-center">
                    No puzzles match this filter.
                </div>
            )}
        </div>
    );
};
