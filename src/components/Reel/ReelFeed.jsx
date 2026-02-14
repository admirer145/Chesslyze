import React, { useState, useEffect, useMemo, useRef, useLayoutEffect, act } from 'react';
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

const normalizeMove = (move) => (move || '').trim().toLowerCase();

const formatEval = (score) => {
    if (typeof score !== 'number') return score || '0.0';
    if (Math.abs(score) >= 10000) return score > 0 ? '+M' : '-M';
    const value = (score / 100).toFixed(1);
    return `${score >= 0 ? '+' : ''}${value}`;
};

const formatCpLoss = (cp) => {
    if (typeof cp !== 'number') return null;
    return `${Math.round(Math.abs(cp))} cp`;
};

const sanitizeExplanation = (text) => {
    if (!text) return '';
    return text
        .replace(/\b[a-h][1-8][a-h][1-8][qrbn]?\b/gi, 'a better move')
        .replace(/\b([KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](=?[QRBN])?[\+#]?)\b/g, 'the best move');
};

const isUciMove = (move) => /^[a-h][1-8][a-h][1-8][qrbn]?$/i.test((move || '').trim());

const uciToMove = (uci) => {
    if (!uci || typeof uci !== 'string') return null;
    const trimmed = uci.trim();
    if (trimmed.length < 4) return null;
    const from = trimmed.substring(0, 2);
    const to = trimmed.substring(2, 4);
    const promotion = trimmed.length > 4 ? trimmed.substring(4, 5) : undefined;
    return { from, to, promotion };
};

const uciToSan = (fen, uci) => {
    if (!isUciMove(uci)) return uci || '-';
    const trimmed = uci.trim();
    const m = uciToMove(trimmed);
    if (!fen || !m) return uci || '-';
    try {
        const chess = new Chess(fen);
        const res = chess.move({ from: m.from, to: m.to, promotion: m.promotion });
        return res?.san || trimmed;
    } catch {
        return trimmed;
    }
};

const uciToSanWithFallback = (fens, uci) => {
    const list = Array.isArray(fens) ? fens : [fens];
    for (const fen of list) {
        const san = uciToSan(fen, uci);
        if (san && san !== uci) return san;
    }
    return uci || '-';
};

const replaceUciWithSan = (text, fens) => {
    if (!text) return '';
    return text.replace(/\b[a-h][1-8][a-h][1-8][qrbn]?\b/gi, (match) => uciToSanWithFallback(fens, match));
};

const getMoveInfoFromPgn = (pgn, ply) => {
    if (!pgn || !ply) return null;
    try {
        const chess = new Chess();
        chess.loadPgn(pgn);
        const moves = chess.history({ verbose: true });
        const entry = moves[ply - 1];
        if (!entry) return null;
        return {
            ply,
            san: entry.san,
            uci: `${entry.from}${entry.to}${entry.promotion || ''}`.toLowerCase(),
            from: entry.from,
            to: entry.to
        };
    } catch (e) {
        return null;
    }
};

const deriveLessonRule = (position) => {
    const motifs = position?.motifs || [];
    if (position?.missedWin) return 'When you are winning, start your calculation with forcing moves: checks, captures, threats.';
    if (position?.missedDefense) return 'When under attack, prioritize king safety and find forcing defenses.';
    if (motifs.includes('fork')) return 'Always scan for fork squares that hit two high-value targets.';
    if (motifs.includes('pin')) return 'Pinned pieces are tactical targets. Look for ways to increase pressure.';
    if (motifs.includes('skewer')) return 'If pieces align on a file/diagonal, search for a skewer.';
    if (motifs.includes('sacrifice')) return 'Sacrifices work when they open lines to the king or create unstoppable threats.';
    if (position?.classification === 'blunder') return 'Before committing, re-check hanging pieces and opponent’s tactical threats.';
    if (position?.classification === 'mistake') return 'Look one move deeper for stronger forcing options.';
    return position?.planHint || 'Look for forcing moves and tactical ideas.';
};

const TACTICAL_MOTIFS = new Set(['fork', 'pin', 'skewer', 'sacrifice']);

const deriveCategories = ({ classification, motifs = [], phase, missedWin, missedDefense, heroMoved }) => {
    const categories = new Set();
    if (phase === 'opening') categories.add('opening');
    if (phase === 'endgame') categories.add('endgame');
    if (motifs.some((m) => TACTICAL_MOTIFS.has(m)) || ['brilliant', 'great'].includes(classification)) {
        categories.add('tactical');
    }
    if (heroMoved && ['blunder', 'mistake', 'inaccuracy'].includes(classification)) categories.add('my_blunder');
    if (!heroMoved && ['blunder', 'mistake', 'inaccuracy'].includes(classification)) categories.add('punish');
    if (heroMoved && ['brilliant', 'great'].includes(classification)) categories.add('brilliant');
    if (heroMoved && missedWin) categories.add('winning_move');
    if (heroMoved && missedDefense) categories.add('defense');
    return Array.from(categories);
};

const computeWeight = (pos) => {
    let weight = 1;
    if (pos.solveStatus === 'correct') weight *= 0.1;
    if (pos.solveStatus === 'incorrect') weight *= 2.2;
    if (!pos.solveStatus) weight *= 2;
    if (pos.reviewFlag) weight *= 3;
    if (pos.missedWin || pos.missedDefense) weight *= 1.8;
    if (pos.classification === 'blunder') weight *= 1.6;
    if (pos.classification === 'mistake') weight *= 1.3;
    if (pos.classification === 'inaccuracy') weight *= 1.1;
    if (pos.inGameSolved) weight *= 0.5;
    if (pos.motifs?.length) weight *= 1.15;
    if (pos.phase === 'opening') weight *= 1.1;
    return Math.max(0.1, weight);
};

const weightedShuffle = (items, weightFn) => {
    return items
        .map((item) => {
            const weight = weightFn(item);
            const key = -Math.log(Math.random()) / weight;
            return { item, key };
        })
        .sort((a, b) => a.key - b.key)
        .map(({ item }) => item);
};

const spreadByGame = (items) => {
    if (items.length < 3) return items;
    const result = [...items];
    for (let i = 1; i < result.length; i += 1) {
        if (result[i].gameId !== result[i - 1].gameId) continue;
        let swapIndex = i + 1;
        while (swapIndex < result.length && result[swapIndex].gameId === result[i - 1].gameId) {
            swapIndex += 1;
        }
        if (swapIndex < result.length) {
            const tmp = result[i];
            result[i] = result[swapIndex];
            result[swapIndex] = tmp;
        }
    }
    return result;
};

const BOARD_LIGHT_KEY = 'boardLightSquare';
const BOARD_DARK_KEY = 'boardDarkSquare';
const BOARD_FLASH_WHITE_KEY = 'boardFlashWhite';
const BOARD_FLASH_BLACK_KEY = 'boardFlashBlack';
const DEFAULT_BOARD_LIGHT = '#e2e8f0';
const DEFAULT_BOARD_DARK = '#475569';
const DEFAULT_FLASH_WHITE = '#D9C64A';
const DEFAULT_FLASH_BLACK = '#D9C64A';

const ReelCard = ({ position, onNext, mode = 'best_move', onSolved, onContinueLine, gameOverride, compact = false, onRevealChange }) => {
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
    const [selectedSquare, setSelectedSquare] = useState(null);
    const [boardColors, setBoardColors] = useState(() => ({
        light: localStorage.getItem(BOARD_LIGHT_KEY) || DEFAULT_BOARD_LIGHT,
        dark: localStorage.getItem(BOARD_DARK_KEY) || DEFAULT_BOARD_DARK
    }));
    const [flashColors, setFlashColors] = useState(() => ({
        white: localStorage.getItem(BOARD_FLASH_WHITE_KEY) || DEFAULT_FLASH_WHITE,
        black: localStorage.getItem(BOARD_FLASH_BLACK_KEY) || DEFAULT_FLASH_BLACK
    }));
    const [lastMoveFlash, setLastMoveFlash] = useState(0);
    // (Explore mode removed) - continue lines open in Dashboard now.

    useEffect(() => {
        if (gameOverride) {
            setGame(gameOverride);
        } else {
            db.games.get(position.gameId).then(setGame);
        }
        setShowSolution(false);
        if (onRevealChange) onRevealChange(false);
        setFeedback(null);
        setTempFen(null);
        setLastAttempt(null);
        setStage('puzzle');
        setAttemptLocked(false);
        setBadgesReady(false);
        setBlunderBadgeStyle(null);
        setSolutionBadgeStyle(null);
        setSelectedSquare(null);
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
    }, [position.id, gameOverride]);

    useEffect(() => {
        if (showSolution || stage !== 'puzzle') {
            setSelectedSquare(null);
        }
    }, [showSolution, stage]);

    useEffect(() => {
        const normalize = (value, fallback) => {
            if (typeof value !== 'string') return fallback;
            return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value) ? value : fallback;
        };
        const updateColors = () => {
            setBoardColors({
                light: normalize(localStorage.getItem(BOARD_LIGHT_KEY), DEFAULT_BOARD_LIGHT),
                dark: normalize(localStorage.getItem(BOARD_DARK_KEY), DEFAULT_BOARD_DARK)
            });
            setFlashColors({
                white: normalize(localStorage.getItem(BOARD_FLASH_WHITE_KEY), DEFAULT_FLASH_WHITE),
                black: normalize(localStorage.getItem(BOARD_FLASH_BLACK_KEY), DEFAULT_FLASH_BLACK)
            });
        };
        updateColors();
        window.addEventListener('boardColorsChanged', updateColors);
        window.addEventListener('storage', updateColors);
        return () => {
            window.removeEventListener('boardColorsChanged', updateColors);
            window.removeEventListener('storage', updateColors);
        };
    }, []);


    useLayoutEffect(() => {
        if (!boardRef.current) return;
        let frame = null;

        const measure = () => {
            if (!boardRef.current) return;
            const width = Math.floor(boardRef.current.getBoundingClientRect().width);
            if (width > 0) {
                setBoardSize((prev) => (Math.abs(prev - width) <= 1 ? prev : width));
            }
        };

        const onResize = () => {
            if (frame) cancelAnimationFrame(frame);
            frame = requestAnimationFrame(measure);
        };

        measure();
        window.addEventListener('resize', onResize);
        return () => {
            window.removeEventListener('resize', onResize);
            if (frame) cancelAnimationFrame(frame);
        };
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

    const attemptMove = (sourceSquare, targetSquare) => {
        if (showSolution || stage !== 'puzzle' || attemptLocked) return false;
        if (!puzzleFen) return false;
        if (typeof sourceSquare !== 'string' || typeof targetSquare !== 'string') return false;
        if (sourceSquare === targetSquare) return false;

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

        const targetFull = (heroMoved ? (targetMove || position.bestMove) : targetMove || '').trim().toLowerCase();
        const targetUCI = targetFull.substring(0, 4);

        setTempFen(base.fen());
        setLastAttempt({ san: moveResult.san, uci: attemptUCI });
        setAttemptLocked(true);

        const shouldReset = true;

        const isCorrect = targetFull.length >= 4 && (targetFull.length > 4
            ? attemptUCI === targetFull || attemptUCI === targetUCI + 'q'
            : attemptUCI.substring(0, 4) === targetUCI);

        if (isCorrect) {
            setFeedback('correct');
            setShowSolution(true);
            if (onRevealChange) onRevealChange(true);
            setStage('solved');
            setTempFen(base.fen());
            setLastAttempt({ san: moveResult.san, uci: attemptUCI });
            if (onSolved) onSolved(true);
            return true;
        }

        if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
        if (messageTimerRef.current) clearTimeout(messageTimerRef.current);

        resetTimerRef.current = setTimeout(() => {
            if (shouldReset) {
                setTempFen(null);
                setLastAttempt(null);
            }
            setFeedback('incorrect');
            setAttemptLocked(false);

            messageTimerRef.current = setTimeout(() => {
                setFeedback(null);
            }, 2000);
        }, 800);

        if (onSolved) onSolved(false);
        return true;
    };

    const onDrop = (...args) => {
        let sourceSquare = args[0];
        let targetSquare = args[1];

        if (typeof sourceSquare === 'object') {
            if (sourceSquare.sourceSquare && sourceSquare.targetSquare) {
                const obj = sourceSquare;
                sourceSquare = obj.sourceSquare;
                targetSquare = obj.targetSquare;
            }
        }
        setSelectedSquare(null);
        return attemptMove(sourceSquare, targetSquare);
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
    const getTitleTag = (tag) => {
        if (!game?.pgn || !tag) return '';
        const match = game.pgn.match(new RegExp(`\\[${tag} "([^"]*)"\\]`));
        const value = match ? match[1] : '';
        if (!value || value === '?' || value === '-') return '';
        return value.trim();
    };
    const getTitle = (color) => {
        const direct = color === 'white' ? game?.whiteTitle : game?.blackTitle;
        if (direct && direct !== '?' && direct !== '-') return direct;
        return getTitleTag(color === 'white' ? 'WhiteTitle' : 'BlackTitle');
    };
    const isHeroWhite = game ? getName(game.white).toLowerCase() === heroUser.toLowerCase() : true;

    // Determine Top (Opponent) vs Bottom (Hero)
    const topPlayer = isHeroWhite ?
        { name: getName(game?.black) || 'Opponent', rating: getRating(game?.black, game?.blackRating), title: getTitle('black') } :
        { name: getName(game?.white) || 'Opponent', rating: getRating(game?.white, game?.whiteRating), title: getTitle('white') };

    const bottomPlayer = isHeroWhite ?
        { name: getName(game?.white) || heroUser, rating: getRating(game?.white, game?.whiteRating), title: getTitle('white') } :
        { name: getName(game?.black) || heroUser, rating: getRating(game?.black, game?.blackRating), title: getTitle('black') };

    const heroMoved = useMemo(() => {
        return (position.turn === 'w' && isHeroWhite) || (position.turn === 'b' && !isHeroWhite);
    }, [position.turn, isHeroWhite]);
    const isBrilliantIdea = useMemo(() => {
        return heroMoved && (position.questionType === 'find_brilliant' || ['brilliant', 'great'].includes(position.classification));
    }, [heroMoved, position.questionType, position.classification]);

    const isReview = useMemo(() => {
        return !!position?.reviewFlag;
    }, [position?.reviewFlag]);

    const toggleReview = async () => {
        if (!position?.id) return;
        const nextReviewAt = isReview ? null : new Date().toISOString();
        await db.positions.update(position.id, { reviewFlag: !isReview, nextReviewAt });
    };

    const blunderInfo = useMemo(() => {
        return getMoveInfoFromPgn(game?.pgn, position?.ply);
    }, [game?.pgn, position?.ply]);

    const opponentLastMove = useMemo(() => {
        if (heroMoved) return null;
        if (!blunderInfo?.from || !blunderInfo?.to) return null;
        return { from: blunderInfo.from, to: blunderInfo.to, color: position?.turn || null };
    }, [heroMoved, blunderInfo?.from, blunderInfo?.to, position?.turn]);

    const flashPalette = useMemo(() => {
        const moveTone = opponentLastMove?.color === 'b' ? 'black' : 'white';
        const base = moveTone === 'black' ? flashColors.black : flashColors.white;
        const hexToRgb = (hex) => {
            if (!hex) return null;
            const raw = hex.replace('#', '');
            if (raw.length === 3) {
                const r = parseInt(raw[0] + raw[0], 16);
                const g = parseInt(raw[1] + raw[1], 16);
                const b = parseInt(raw[2] + raw[2], 16);
                return { r, g, b };
            }
            if (raw.length === 6) {
                const r = parseInt(raw.slice(0, 2), 16);
                const g = parseInt(raw.slice(2, 4), 16);
                const b = parseInt(raw.slice(4, 6), 16);
                return { r, g, b };
            }
            return null;
        };
        const rgb = hexToRgb(base) || { r: 245, g: 200, b: 75 };
        const rgba = (a) => `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${a})`;
        return {
            fromFill: rgba(0.22),
            fromRing: rgba(0.7),
            toFill: rgba(0.4),
            toRing: rgba(0.95)
        };
    }, [opponentLastMove?.color, flashColors]);

    useEffect(() => {
        if (!opponentLastMove) return;
        setLastMoveFlash((v) => v + 1);
    }, [opponentLastMove?.from, opponentLastMove?.to, position?.id]);

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
        // If it's our blunder (heroMoved), we are looking for the best move from the *original* position
        // This is stored in position.bestMove (engine analyzed the pre-move position).
        if (heroMoved) {
            return position?.bestMove || null;
        }

        // If it's opponent's blunder (!heroMoved), we are looking for the move that punishes it.
        // Prefer the stored response from the ReelFeed builder, then fall back to analysisLog.
        if (position?.bestResponse) return position.bestResponse;
        if (!game?.analysisLog || !position?.ply) return null;
        const nextEntry = game.analysisLog.find((e) => e.ply === position.ply + 1);
        return nextEntry?.bestMove || null;
    }, [game?.analysisLog, position?.ply, heroMoved, position?.bestMove, position?.bestResponse]);

    const bestMoveSan = useMemo(() => {
        const move = targetMove || (heroMoved ? position?.bestMove : null);
        if (!move) return '-';
        return uciToSanWithFallback([puzzleFen, position?.fen, blunderFen], move);
    }, [puzzleFen, position?.fen, blunderFen, targetMove, heroMoved, position?.bestMove]);

    const puzzleTurn = useMemo(() => {
        if (!puzzleFen) return position?.turn || null;
        try {
            const chess = new Chess(puzzleFen);
            return chess.turn();
        } catch {
            return position?.turn || null;
        }
    }, [puzzleFen, position?.turn]);

    const onSquareClick = (info) => {
        if (showSolution || stage !== 'puzzle' || attemptLocked) return;
        const square = typeof info === 'string' ? info : info?.square;
        if (!puzzleFen || typeof square !== 'string') return;
        let base = null;
        try {
            base = new Chess(puzzleFen);
        } catch {
            return;
        }
        const piece = base.get(square);
        const turn = base.turn();

        if (!selectedSquare) {
            if (piece && piece.color === turn) {
                setSelectedSquare(square);
            }
            return;
        }

        if (selectedSquare === square) {
            setSelectedSquare(null);
            return;
        }

        const moved = attemptMove(selectedSquare, square);
        if (moved) {
            setSelectedSquare(null);
            return;
        }

        if (piece && piece.color === turn) {
            setSelectedSquare(square);
        } else {
            setSelectedSquare(null);
        }
    };

    const onPieceClick = (info) => {
        if (!info?.square) return;
        onSquareClick(info);
    };

    const sideToMoveLabel = puzzleTurn === 'b' ? 'Black' : 'White';
    const heroSideLabel = isHeroWhite ? 'White' : 'Black';
    const isHeroToMove = puzzleTurn ? (puzzleTurn === 'w') === isHeroWhite : heroMoved;

    const playedSan = useMemo(() => {
        return blunderInfo?.san || null;
    }, [blunderInfo]);

    const lastAttemptSan = useMemo(() => {
        return lastAttempt?.san || null;
    }, [lastAttempt]);

    const displayFen = useMemo(() => {
        if (stage === 'intro') return blunderFen; // Always show the blunder being played/played
        if (tempFen) return tempFen; // Shows user's attempt (correct or wrong)
        return puzzleFen; // Default start state for puzzle
    }, [stage, blunderFen, tempFen, puzzleFen]);

    const solutionSquare = useMemo(() => {
        if (!targetMove || targetMove.length < 4) return null;
        return targetMove.substring(2, 4);
    }, [targetMove]);

    const lastMoveStyles = useMemo(() => {
        if (!opponentLastMove) return {};
        const flashVariant = lastMoveFlash % 2 === 0 ? 'a' : 'b';
        const palette = flashPalette;
        const fromStyle = {
            backgroundImage: `radial-gradient(circle at 50% 50%, ${palette.fromFill}, rgba(0, 0, 0, 0) 70%)`,
            boxShadow: `inset 0 0 0 2px ${palette.fromRing}`
        };
        const toStyle = {
            backgroundImage: `radial-gradient(circle at 50% 50%, ${palette.toFill}, rgba(0, 0, 0, 0) 70%)`,
            boxShadow: `inset 0 0 0 2px ${palette.toRing}, 0 0 12px ${palette.toFill}`
        };
        const flashFrom = {
            animation: `last-move-flash-from-${flashVariant} 0.45s cubic-bezier(0.2, 0.9, 0.2, 1)`
        };
        const flashTo = {
            animation: `last-move-flash-to-${flashVariant} 0.45s cubic-bezier(0.2, 0.9, 0.2, 1)`
        };
        return {
            [opponentLastMove.from]: { ...fromStyle, ...flashFrom },
            [opponentLastMove.to]: { ...toStyle, ...flashTo }
        };
    }, [opponentLastMove, lastMoveFlash, flashPalette]);

    const selectedSquareStyles = useMemo(() => {
        if (!selectedSquare) return {};
        return {
            [selectedSquare]: {
                boxShadow: 'inset 0 0 0 2px rgba(59, 130, 246, 0.95)',
                backgroundImage: 'radial-gradient(circle at 50% 50%, rgba(59, 130, 246, 0.22), rgba(0, 0, 0, 0) 70%)'
            }
        };
    }, [selectedSquare]);

    const combinedSquareStyles = useMemo(() => {
        return { ...lastMoveStyles, ...selectedSquareStyles };
    }, [lastMoveStyles, selectedSquareStyles]);

    useEffect(() => {
        if (isBrilliantIdea) {
            setStage('puzzle');
            setAttemptLocked(false);
            return;
        }
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
    }, [heroMoved, isBrilliantIdea, position?.id]);

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
            const type = position.classification || 'mistake';
            const article = ['inaccuracy'].includes(type) ? 'an' : 'a';
            return `Punish ${article} ${type}`;
        }
        if (position.questionType === 'find_brilliant' || ['brilliant', 'great'].includes(position.classification)) {
            return 'Find the brilliant idea';
        }
        if (position.missedDefense) return 'Find the best defense';
        if (position.missedWin || position.questionType === 'convert_win') return 'Find the winning move';
        if (position.classification === 'blunder') return 'Fix the blunder';
        return 'Find the best move';
    };



    return (
        <div className="w-full h-full flex flex-col items-center justify-center relative p-6" style={{ scrollSnapAlign: 'start' }}>

            <div
                className={`bg-panel border rounded-xl shadow-lg w-full relative ${compact ? 'p-4' : 'p-6'}`}
                style={{
                    maxWidth: compact ? 720 : 620,
                    width: '100%'
                }}
            >

                {!compact && (
                    <>
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
                                className={`reel-eval-pill ${position.score > 0 ? 'reel-eval--good' : position.score < 0 ? 'reel-eval--bad' : ''}`}
                                title="Engine evaluation for this position (White perspective)"
                            >
                                <span className="reel-eval-pill__k">Eval</span>
                                <span className="reel-eval-pill__v">{formatEval(position.score)}</span>
                            </div>
                        </div>

                        {/* Opponent (Top) */}
                        <div className="flex justify-between items-end px-1 mb-1">
                            <div className="flex items-baseline gap-2 text-secondary">
                                {topPlayer.title && <span className="title-badge">{topPlayer.title}</span>}
                                <span className="font-semibold">{topPlayer.name}</span>
                                <span className="text-sm font-light">({topPlayer.rating})</span>
                            </div>
                        </div>
                    </>
                )}

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
                                onPieceClick: onPieceClick,
                                onSquareClick: onSquareClick,
                                boardOrientation: isHeroWhite ? 'white' : 'black',
                                animationDuration: PIECE_ANIMATION_MS,
                                darkSquareStyle: { backgroundColor: boardColors.dark },
                                lightSquareStyle: { backgroundColor: boardColors.light },
                                squareStyles: combinedSquareStyles
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

                <div>
                    {!compact && (
                        <div className="flex justify-between items-start px-1 mb-4">
                            <div className="flex items-baseline gap-2 text-primary">
                                {bottomPlayer.title && <span className="title-badge">{bottomPlayer.title}</span>}
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
                    )}

                    {/* Context / Feedback Area */}
                    <div className={`mb-6 text-center ${compact ? 'min-h-[60px]' : 'min-h-[36px]'} flex items-center justify-center`}>
                        {showSolution ? (
                            <div className="w-full animate-fade-in">
                                <div className="p-2 rounded bg-subtle text-green-400 flex items-center justify-center gap-2 text-sm font-medium w-full mb-2">
                                    <CheckCircle size={16} /> Best Move: {bestMoveSan}
                                </div>
                                {blunderInfo && (
                                    <div className="text-xs text-secondary mb-2">
                                        Played: {playedSan}
                                    </div>
                                )}
                                {lastAttempt && (
                                    <div className="text-xs text-secondary mb-2">
                                        Your move: {lastAttemptSan}
                                    </div>
                                )}
                                <p className="text-xs text-muted leading-relaxed">
                                    {replaceUciWithSan(position.explanation || "No explanation available.", [puzzleFen, position?.fen, blunderFen])}
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
                                <strong>{sideToMoveLabel} to move</strong>
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
                            onClick={() => {
                                const next = !showSolution;
                                setShowSolution(next);
                                if (onRevealChange) onRevealChange(next);
                            }}
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

        </div>
    );
};

export const ReelFeed = () => {
    const heroUser = localStorage.getItem('heroUser');
    const navigate = useNavigate();
    const [deckNonce, setDeckNonce] = useState(0);
    const [solutionRevealed, setSolutionRevealed] = useState(false);
    const [heldPuzzle, setHeldPuzzle] = useState(null);
    const [puzzleLocked, setPuzzleLocked] = useState(false);
    const [positionsCache, setPositionsCache] = useState(null);
    // removed left-panel search and resize controls
    const [recentIds, setRecentIds] = useState(() => {
        try {
            const raw = localStorage.getItem('smartPuzzleRecentIds');
            return Array.isArray(JSON.parse(raw)) ? JSON.parse(raw) : [];
        } catch {
            return [];
        }
    });
    const recentIdsRef = useRef(recentIds);
    const [deck, setDeck] = useState([]);

    // Complex query: Join positions with games to filter by Hero's turn
    const positions = useLiveQuery(async () => {
        if (!heroUser) return null;

        // Pull recent positions first to keep feed updated with fresh analysis
        const candidates = await db.positions
            .orderBy('id')
            .reverse()
            .limit(1200)
            .toArray();

        const critical = candidates.filter((pos) => (
            ['blunder', 'mistake', 'brilliant', 'great', 'miss', 'inaccuracy'].includes(pos.classification)
            || pos.missedWin
            || pos.missedDefense
        ));

        const uniqueGameIds = [...new Set(critical.map((pos) => pos.gameId))];
        const games = await db.games.bulkGet(uniqueGameIds);
        const gameMap = new Map();
        games.forEach((game) => {
            if (game) gameMap.set(game.id, game);
        });

        const validPositions = [];

        for (const pos of critical) {
            const game = gameMap.get(pos.gameId);
            if (!game) continue;
            if (typeof game.isHero === 'boolean' && game.isHero === false) continue;

            const gameWhite = typeof game.white === 'string' ? game.white : game.white?.name || '';
            const gameBlack = typeof game.black === 'string' ? game.black : game.black?.name || '';
            const isHeroWhite = gameWhite.toLowerCase() === heroUser.toLowerCase();
            const isHeroBlack = gameBlack.toLowerCase() === heroUser.toLowerCase();

            if (isHeroWhite || isHeroBlack) {
                const heroSide = isHeroWhite ? 'w' : 'b';
                const heroMoved = pos.turn === heroSide;
                const log = Array.isArray(game.analysisLog) ? game.analysisLog : [];
                const responseEntry = log.find((entry) => entry.ply === pos.ply + 1);
                const heroResponse = responseEntry?.move;
                const bestResponse = responseEntry?.bestMove;
                if (heroMoved && !pos.bestMove) continue;
                if (!heroMoved && !bestResponse) continue;
                const heroPunished = !heroMoved
                    && normalizeMove(heroResponse)
                    && normalizeMove(heroResponse) === normalizeMove(bestResponse);
                const inGameSolved = heroMoved
                    ? ['brilliant', 'great', 'best'].includes(pos.classification)
                    : heroPunished;
                const categories = deriveCategories({
                    classification: pos.classification,
                    motifs: pos.motifs || [],
                    phase: pos.phase,
                    missedWin: pos.missedWin,
                    missedDefense: pos.missedDefense,
                    heroMoved
                });

                validPositions.push({
                    ...pos,
                    _game: game,
                    heroMoved,
                    heroSide,
                    inGameSolved,
                    heroResponse,
                    bestResponse,
                    categories
                });
            }
        }

        const solved = [];
        const unsolved = [];
        const review = [];

        const now = new Date();
        validPositions.forEach((pos) => {
            // Review: Explicit flag or due date
            if (pos.reviewFlag || (pos.nextReviewAt && new Date(pos.nextReviewAt) <= now)) {
                review.push(pos);
            }

            // Solved vs Unsolved
            if (pos.solveStatus === 'correct' && !pos.reviewFlag) {
                solved.push(pos);
            } else {
                unsolved.push(pos);
            }
        });

        return {
            solved,
            unsolved,
            review,
            all: validPositions
        };
    }, [heroUser]);

    const [section, setSection] = useState('unsolved');
    const [mode, setMode] = useState('all');
    const [index, setIndex] = useState(0);
    const [quizActive, setQuizActive] = useState(false);
    const [quizScore, setQuizScore] = useState(0);
    const [quizIndex, setQuizIndex] = useState(0);
    const [quizSet, setQuizSet] = useState([]);

    useEffect(() => {
        localStorage.setItem('smartPuzzleRecentIds', JSON.stringify(recentIds.slice(-30)));
        recentIdsRef.current = recentIds;
    }, [recentIds]);

    useEffect(() => {
        if (!positions) return;
        if (!quizActive) return;
        if (quizSet.length === 0) {
            const pool = [...positions.review, ...positions.unsolved];
            const unique = Array.from(new Set(pool.map((pos) => pos.id))).map(id => pool.find(p => p.id === id));
            const shuffled = weightedShuffle(unique, computeWeight);
            setQuizSet(shuffled.slice(0, 5));
            setQuizIndex(0);
            setQuizScore(0);
        }
    }, [quizActive, positions, quizSet.length]);

    useEffect(() => {
        if (positions) setPositionsCache(positions);
    }, [positions]);

    const safePositions = positions || positionsCache || { solved: [], unsolved: [], review: [], all: [] };
    const noData = safePositions.unsolved.length === 0 && safePositions.solved.length === 0 && safePositions.review.length === 0;

    const activePositions = section === 'unsolved'
        ? safePositions.unsolved
        : section === 'review'
            ? safePositions.review
            : safePositions.solved;

    const focusMatches = (pos) => {
        if (mode === 'all') return true;
        if (mode === 'tactical') return pos.categories?.includes('tactical');
        if (mode === 'opening') return pos.categories?.includes('opening');
        if (mode === 'my_blunder') return pos.categories?.includes('my_blunder');
        if (mode === 'punish') return pos.categories?.includes('punish');
        if (mode === 'brilliant') return pos.categories?.includes('brilliant');
        if (mode === 'winning_move') return pos.categories?.includes('winning_move');
        if (mode === 'defense') return pos.categories?.includes('defense');
        return true;
    };

    const filteredPositions = useMemo(
        () => activePositions.filter((pos) => focusMatches(pos)),
        [activePositions, mode]
    );

    const filteredKey = useMemo(
        () => filteredPositions.map((p) => p.id).join('|'),
        [filteredPositions]
    );

    useEffect(() => {
        if (puzzleLocked && deck.length > 0) return;
        if (!filteredPositions.length) {
            setDeck([]);
            return;
        }
        const recent = recentIdsRef.current || [];
        const pool = filteredPositions.length > 8
            ? filteredPositions.filter((pos) => !recent.includes(pos.id))
            : filteredPositions;
        const shuffled = spreadByGame(weightedShuffle(pool.length ? pool : filteredPositions, computeWeight));
        setDeck(shuffled);
    }, [filteredKey, deckNonce, puzzleLocked, deck.length, filteredPositions.length]);

    const activeSet = deck;
    const activePosition = activeSet.length > 0 ? activeSet[index % activeSet.length] : null;
    const basePuzzle = !quizActive && heldPuzzle ? heldPuzzle : activePosition;
    const currentPuzzle = quizActive && quizSet[quizIndex] ? quizSet[quizIndex] : basePuzzle;
    useEffect(() => {
        if (quizActive) {
            setPuzzleLocked(false);
            return;
        }
        if (currentPuzzle?.id) {
            setPuzzleLocked(true);
        }
    }, [currentPuzzle?.id, quizActive]);
    const activePositionLive = useLiveQuery(
        () => (currentPuzzle?.id ? db.positions.get(currentPuzzle.id) : null),
        [currentPuzzle?.id]
    );
    const displayPosition = currentPuzzle
        ? { ...currentPuzzle, ...(activePositionLive || {}) }
        : activePositionLive;
    const activeGame = displayPosition?._game || null;
    const activeMoveInfo = getMoveInfoFromPgn(activeGame?.pgn, displayPosition?.ply);
    const reviewFlag = !!displayPosition?.reviewFlag;
    const evalLoss = formatCpLoss(displayPosition?.loss);
    const sideToPlay = useMemo(() => {
        if (!displayPosition?.turn) return 'Side to move';
        const turn = displayPosition.turn;
        const effective = displayPosition.heroMoved ? turn : (turn === 'w' ? 'b' : 'w');
        return effective === 'w' ? 'White to play' : 'Black to play';
    }, [displayPosition?.turn, displayPosition?.heroMoved]);
    const puzzleTitle = (() => {
        if (!displayPosition) return '';
        if (!displayPosition.heroMoved) return 'Punish the Mistake';
        if (displayPosition.missedWin) return 'Find the Winning Move';
        if (displayPosition.missedDefense) return 'Find the Best Defense';
        if (['brilliant', 'great'].includes(displayPosition.classification)) return 'Find the Brilliant Idea';
        if (displayPosition.classification === 'blunder') return 'Fix the Blunder';
        return 'Find the Best Move';
    })();

    const handleNext = () => {
        setHeldPuzzle(null);
        setPuzzleLocked(false);
        setIndex((prev) => (prev + 1) % activeSet.length);
    };

    const focusCounts = {
        all: activePositions.length,
        tactical: activePositions.filter((p) => p.categories?.includes('tactical')).length,
        opening: activePositions.filter((p) => p.categories?.includes('opening')).length,
        my_blunder: activePositions.filter((p) => p.categories?.includes('my_blunder')).length,
        punish: activePositions.filter((p) => p.categories?.includes('punish')).length,
        brilliant: activePositions.filter((p) => p.categories?.includes('brilliant')).length,
        winning_move: activePositions.filter((p) => p.categories?.includes('winning_move')).length,
        defense: activePositions.filter((p) => p.categories?.includes('defense')).length
    };

    useEffect(() => {
        setIndex(0);
        setHeldPuzzle(null);
        setPuzzleLocked(false);
    }, [section, mode, deckNonce]);

    useEffect(() => {
        setSolutionRevealed(false);
    }, [index, section, mode, deckNonce, currentPuzzle?.id, quizActive, quizIndex]);

    useEffect(() => {
        if (quizActive) {
            setHeldPuzzle(null);
            setPuzzleLocked(false);
        }
    }, [quizActive]);


    useEffect(() => {
        if (index >= activeSet.length) {
            setIndex(0);
        }
    }, [activeSet.length, index]);

    useEffect(() => {
        const current = activeSet[index];
        if (!current?.id) return;
        setRecentIds((prev) => {
            const next = [...prev.filter((id) => id !== current.id), current.id];
            return next.slice(-30);
        });
        db.positions.update(current.id, { lastSeenAt: new Date().toISOString() });
    }, [activeSet, index]);

    const scheduleReview = async (pos, correct) => {
        if (!pos?.id) return;
        const now = new Date();
        const next = new Date();
        next.setDate(next.getDate() + (correct ? 7 : 1));

        const update = {
            lastAttemptedAt: now.toISOString(),
            lastReviewedAt: now.toISOString(),
            solveStatus: correct ? 'correct' : 'incorrect',
            lastSolvedAt: correct ? now.toISOString() : pos.lastSolvedAt || null,
            correctCount: (pos.correctCount || 0) + (correct ? 1 : 0),
            wrongCount: (pos.wrongCount || 0) + (!correct ? 1 : 0)
        };

        // Correct puzzles should not resurface unless explicitly marked for review
        if (correct) {
            update.nextReviewAt = pos.reviewFlag ? next.toISOString() : null;
        } else {
            update.nextReviewAt = next.toISOString();
        }

        await db.positions.update(pos.id, update);
    };

    const handleQuizSolved = (correct) => {
        if (!quizActive) return;
        if (correct) setQuizScore((s) => s + 1);
        if (correct) {
            setTimeout(() => {
                setQuizIndex((i) => Math.min(quizSet.length - 1, i + 1));
            }, 500);
        }
    };

    const openInDashboard = ({ gameId, moveIndex }) => {
        if (!gameId && gameId !== 0) return;
        localStorage.setItem('activeGameId', String(gameId));
        localStorage.setItem('activeGameJumpGameId', String(gameId));
        localStorage.setItem('activeGameJumpMoveIndex', String(typeof moveIndex === 'number' ? moveIndex : -1));
        window.dispatchEvent(new Event('activeGameChanged'));
        navigate('/');
    };

    const toggleReviewFlag = async () => {
        if (!displayPosition?.id) return;
        const nextReviewAt = reviewFlag ? null : new Date().toISOString();
        await db.positions.update(displayPosition.id, { reviewFlag: !reviewFlag, nextReviewAt });
    };

    const heroLower = (heroUser || '').toLowerCase();
    const opponentInfo = useMemo(() => {
        if (!activeGame) return { name: 'Opponent', rating: '-', title: '' };
        const whiteName = typeof activeGame.white === 'string' ? activeGame.white : activeGame.white?.name || '';
        const blackName = typeof activeGame.black === 'string' ? activeGame.black : activeGame.black?.name || '';
        const isHeroWhite = heroLower && whiteName.toLowerCase() === heroLower;
        const name = isHeroWhite ? blackName : whiteName;
        const rating = isHeroWhite ? activeGame.blackRating : activeGame.whiteRating;
        const title = isHeroWhite ? activeGame.blackTitle : activeGame.whiteTitle;
        return { name: name || 'Opponent', rating: rating || '-', title: title || '' };
    }, [activeGame, heroLower]);

    return (
        <div className="puzzle-shell">
            <div className="puzzle-main">
                <div className="puzzle-header">
                    <div>
                        <div className="puzzle-title">Smart Puzzles</div>
                        <div className="puzzle-subtitle">Train with lessons extracted from your own games.</div>
                    </div>
                    <div className="puzzle-header__actions">
                        <button className="btn btn-secondary" onClick={() => setDeckNonce((n) => n + 1)}>Shuffle</button>
                        <button
                            className={`btn ${quizActive ? 'btn-secondary' : 'btn-primary'}`}
                            onClick={() => {
                                if (quizActive) {
                                    setQuizActive(false);
                                    setQuizSet([]);
                                    setQuizIndex(0);
                                    setQuizScore(0);
                                } else {
                                    setQuizActive(true);
                                }
                            }}
                            disabled={!safePositions.unsolved.length && !quizActive}
                        >
                            {quizActive ? 'Exit Sprint' : 'Sprint Mode'}
                        </button>
                    </div>
                </div>

                <div className={`puzzle-stage ${noData ? 'puzzle-stage--solo' : ''}`}>
                    <div className="puzzle-board">
                        {quizActive ? (
                            quizSet.length > 0 ? (
                                <div className="puzzle-sprint">
                                    <div className="puzzle-sprint__meta">
                                        Sprint {quizIndex + 1}/{quizSet.length} • Score {quizScore}
                                    </div>
                                    <button
                                        className="btn btn-secondary"
                                        onClick={() => {
                                            setQuizActive(false);
                                            setQuizSet([]);
                                            setQuizIndex(0);
                                            setQuizScore(0);
                                        }}
                                    >
                                        Exit Sprint
                                    </button>
                                    <ReelCard
                                        position={quizSet[quizIndex]}
                                        mode={quizSet[quizIndex]?.questionType || 'best_move'}
                                        onNext={() => setQuizIndex((i) => Math.min(quizSet.length - 1, i + 1))}
                                        onSolved={(correct) => {
                                            handleQuizSolved(correct);
                                            scheduleReview(quizSet[quizIndex], correct);
                                        }}
                                        onContinueLine={openInDashboard}
                                        gameOverride={quizSet[quizIndex]?._game}
                                        onRevealChange={setSolutionRevealed}
                                        compact
                                    />
                                    {quizIndex === quizSet.length - 1 && (
                                        <div className="puzzle-sprint__done">
                                            <div className="text-lg font-bold text-primary mb-1">Sprint Complete</div>
                                            <div className="text-sm text-secondary">Score: {quizScore}/{quizSet.length}</div>
                                            <button className="mt-2 btn btn-primary w-full" onClick={() => setQuizActive(false)}>Close</button>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="puzzle-empty">
                                    <p>No sprint puzzles available.</p>
                                    <button className="mt-4 btn btn-secondary" onClick={() => setQuizActive(false)}>Back</button>
                                </div>
                            )
                        ) : (
                            activeSet.length > 0 ? (
                                <ReelCard
                                    position={displayPosition}
                                    onNext={handleNext}
                                    mode={mode}
                                    onSolved={(correct) => {
                                        scheduleReview(displayPosition, correct);
                                        if (correct) setHeldPuzzle(displayPosition);
                                    }}
                                    onContinueLine={openInDashboard}
                                    gameOverride={activeGame}
                                    onRevealChange={setSolutionRevealed}
                                />
                            ) : (
                                <div className="puzzle-empty">
                                    <div className="puzzle-empty__icon">
                                        <CheckCircle size={32} />
                                    </div>
                                    {noData && (
                                        <>
                                            <p className="text-lg text-primary mb-2">No puzzles yet.</p>
                                            <p className="text-sm">Import and analyze games to generate lessons.</p>
                                        </>
                                    )}
                                    {!noData && activePositions.length === 0 && section === 'unsolved' && (
                                        <>
                                            <p className="text-lg text-primary mb-2">Inbox cleared.</p>
                                            <p className="text-sm">Import more games or switch focus.</p>
                                        </>
                                    )}
                                    {!noData && activePositions.length === 0 && section === 'review' && (
                                        <>
                                            <p className="text-lg text-primary mb-2">No review puzzles due.</p>
                                            <p className="text-sm">Mark puzzles for review to build a cycle.</p>
                                        </>
                                    )}
                                    {!noData && activePositions.length === 0 && section === 'solved' && (
                                        <>
                                            <p className="text-lg text-primary mb-2">No mastered puzzles yet.</p>
                                            <p className="text-sm">Solve puzzles to build a mastery library.</p>
                                        </>
                                    )}
                                    {!noData && activePositions.length > 0 && (
                                        <>
                                            <p className="text-lg text-primary mb-2">No puzzles in this focus.</p>
                                            <p className="text-sm">Try another focus.</p>
                                        </>
                                    )}
                                </div>
                            )
                        )}
                    </div>

                    {!noData && (
                        <aside className="puzzle-panel puzzle-panel--right">
                            <div className="puzzle-panel__section">
                                <div className="puzzle-panel__title">Coach Notes</div>
                                {displayPosition ? (
                                <>
                                    <div className="puzzle-note">
                                        <strong>{deriveLessonRule(displayPosition)}</strong>
                                    </div>
                                    {displayPosition.inGameSolved && (
                                        <div className="puzzle-note puzzle-note--subtle">
                                            You already found this idea in the game. Low priority, but great for reinforcement.
                                        </div>
                                    )}
                                </>
                            ) : (
                                <div className="puzzle-note">Select a puzzle to see coaching notes.</div>
                            )}
                        </div>

                        <div className="puzzle-panel__section">
                            <div className="puzzle-panel__title">Review Control</div>
                            <button className={`btn ${reviewFlag ? 'btn-secondary' : 'btn-primary'} w-full`} onClick={toggleReviewFlag} disabled={!displayPosition}>
                                {reviewFlag ? 'Remove from Review' : 'Mark for Review'}
                            </button>
                        </div>

                        <div className="puzzle-panel__section">
                            <div className="puzzle-panel__title">Feed Source</div>
                            <div className="puzzle-button-list">
                                {[
                                    { id: 'unsolved', label: 'Inbox', count: safePositions.unsolved.length },
                                    { id: 'review', label: 'Review', count: safePositions.review.length },
                                    { id: 'solved', label: 'Mastered', count: safePositions.solved.length }
                                ].map((opt) => (
                                    <button
                                        key={opt.id}
                                        onClick={() => { setSection(opt.id); setIndex(0); }}
                                        className={`puzzle-button ${section === opt.id ? 'puzzle-button--active' : ''}`}
                                    >
                                        <span>{opt.label}</span>
                                        <span className="puzzle-button__count">{opt.count ?? 0}</span>
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="puzzle-panel__section">
                            <div className="puzzle-panel__title">Puzzle Focus</div>
                            <div className="puzzle-button-list">
                                {[
                                    { id: 'all', label: 'Smart Mix', count: focusCounts.all },
                                    { id: 'tactical', label: 'Tactical', count: focusCounts.tactical },
                                    { id: 'opening', label: 'Opening', count: focusCounts.opening },
                                    { id: 'my_blunder', label: 'Fix My Blunders', count: focusCounts.my_blunder },
                                    { id: 'punish', label: 'Punish Opponent', count: focusCounts.punish },
                                    { id: 'brilliant', label: 'Brilliant Ideas', count: focusCounts.brilliant },
                                    { id: 'winning_move', label: 'Only Winning Move', count: focusCounts.winning_move },
                                    { id: 'defense', label: 'Best Defense', count: focusCounts.defense }
                                ].map((opt) => (
                                    <button
                                        key={opt.id}
                                        onClick={() => setMode(opt.id)}
                                        className={`puzzle-button ${mode === opt.id ? 'puzzle-button--active' : ''}`}
                                    >
                                        <span>{opt.label}</span>
                                        <span className="puzzle-button__count">{opt.count}</span>
                                    </button>
                                ))}
                            </div>
                        </div>

                        
                    </aside>
                )}
                </div>
            </div>
        </div>
    );
};
