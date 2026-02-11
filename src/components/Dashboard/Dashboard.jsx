import React, { useLayoutEffect, useState, useEffect, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../services/db';
import { Chessboard } from 'react-chessboard';
import { ArrowUpRight, Activity, Target, Zap, ChevronLeft, ChevronRight, FastForward, Rewind, ChevronDown } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Chess } from 'chess.js';
import { processGame } from '../../services/analyzer';
import { AnalyticsPanel } from './AnalyticsPanel';
import { AIAnalysisModal } from './AIAnalysisModal';
import { AIInsightsView } from './AIInsightsView';
import { Sparkles } from 'lucide-react';

const StatRow = ({ label, value, subtext, icon: Icon, color }) => (
    <div className="flex items-center gap-4 p-3 rounded-md hover:bg-subtle transition-colors cursor-default">
        <div className={`p-2 rounded-md bg-app border text-${color}-400`}>
            <Icon size={16} />
        </div>
        <div className="flex-1">
            <div className="flex justify-between items-baseline">
                <span className="text-sm font-medium text-primary">{label}</span>
                <span className="font-mono text-sm font-semibold text-primary">{value}</span>
            </div>
            {subtext && <p className="text-xs text-secondary mt-1">{subtext}</p>}
        </div>
    </div>
);

export const Dashboard = () => {
    const DASHBOARD_STATE_PREFIX = 'dashboardState:';
    const latestGame = useLiveQuery(() => db.games.orderBy('date').reverse().first());
    const [selectedGameId, setSelectedGameId] = useState(() => localStorage.getItem('activeGameId'));

    useEffect(() => {
        const handleActiveChange = () => {
            setSelectedGameId(localStorage.getItem('activeGameId'));
        };
        window.addEventListener('activeGameChanged', handleActiveChange);
        return () => window.removeEventListener('activeGameChanged', handleActiveChange);
    }, []);

    const selectedGame = useLiveQuery(async () => {
        if (!selectedGameId) return null;
        const id = Number(selectedGameId);
        if (!id || Number.isNaN(id)) return null;
        return db.games.get(id);
    }, [selectedGameId]);

    const stats = useLiveQuery(async () => {
        const all = await db.games.toArray();
        if (!all.length) return { total: 0, wins: 0, winRate: 0, accuracy: 0, avgCpLoss: 0, maxStreak: 0, maxSwing: 0 };

        let wins = 0;
        let totalAccuracy = 0;
        let analyzedCount = 0;
        let totalCpLoss = 0;
        let cpCount = 0;
        let maxStreak = 0;
        let maxSwing = 0;
        let bookMoves = 0;
        let bookTotal = 0;

        const heroUser = (localStorage.getItem('heroUser') || '').toLowerCase();
        const heroGames = all.filter((g) => {
            if (typeof g.isHero === 'boolean') return g.isHero;
            return heroUser && (g.white?.toLowerCase() === heroUser || g.black?.toLowerCase() === heroUser);
        });

        heroGames.forEach(g => {
            const isWhite = heroUser && g.white?.toLowerCase() === heroUser;
            const isBlack = heroUser && g.black?.toLowerCase() === heroUser;
            if (isWhite && g.result === '1-0') wins++;
            if (isBlack && g.result === '0-1') wins++;

            if (g.accuracy) {
                const acc = isWhite ? g.accuracy.white : g.accuracy.black;
                if (typeof acc === 'number') {
                    totalAccuracy += acc;
                    analyzedCount++;
                }
            }
            if (typeof g.avgCpLoss === 'number') {
                totalCpLoss += g.avgCpLoss;
                cpCount++;
            }
            if (typeof g.maxAccuracyStreak === 'number') {
                maxStreak = Math.max(maxStreak, g.maxAccuracyStreak);
            }
            if (typeof g.maxEvalSwing === 'number') {
                maxSwing = Math.max(maxSwing, g.maxEvalSwing);
            }
            if (Array.isArray(g.analysisLog)) {
                g.analysisLog.forEach((entry) => {
                    if (entry.bookMove) bookMoves += 1;
                    if (entry.phase === 'opening') bookTotal += 1;
                });
            }
        });

        return {
            total: heroGames.length,
            wins,
            winRate: heroGames.length ? Math.round((wins / heroGames.length) * 100) : 0,
            accuracy: analyzedCount ? Math.round(totalAccuracy / analyzedCount) : 0,
            avgCpLoss: cpCount ? Math.round(totalCpLoss / cpCount) : 0,
            maxStreak,
            maxSwing,
            bookMoves,
            bookTotal
        };
    });

    const queueCount = useLiveQuery(() => db.games.filter(g => g.analysisStatus === 'pending' || g.analysisStatus === 'idle' || (!g.analyzed && !g.analysisStatus)).count());
    const failedCount = useLiveQuery(() => db.games.filter(g => g.analysisStatus === 'failed').count());

    const [moveIndex, setMoveIndex] = useState(-1); // -1 = start
    const [history, setHistory] = useState([]);
    const [startFen, setStartFen] = useState('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');

    // Track loaded game ID to prevent resetting when analysis updates the record
    const loadedGameIdRef = React.useRef(null);

    // Responsive board width
    const [boardWidth, setBoardWidth] = useState(500);
    const boardContainerRef = React.useRef(null);

    const [activeTab, setActiveTab] = useState('moves'); // 'moves' | 'analysis'
    const [hoverArrow, setHoverArrow] = useState(null); // { from, to }
    const [previewFen, setPreviewFen] = useState(null);
    const [badgeStyle, setBadgeStyle] = useState(null); // { left, top }
    const [rightPanelOpen, setRightPanelOpen] = useState(() => {
        if (typeof window === 'undefined') return true;
        return window.innerWidth >= 1100;
    });

    const [analysisMenuOpen, setAnalysisMenuOpen] = useState(false);
    const [lastAnalyzeMode, setLastAnalyzeMode] = useState(() => localStorage.getItem('dashboardAnalyzeMode') || 'stockfish');
    const loadSavedMoveIndex = (gameId, maxIndex) => {
        if (!gameId || typeof window === 'undefined') return null;
        try {
            const raw = localStorage.getItem(`${DASHBOARD_STATE_PREFIX}${gameId}`);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            const saved = Number(parsed?.moveIndex);
            if (!Number.isFinite(saved)) return null;
            const clamped = Math.max(-1, Math.min(maxIndex, saved));
            return clamped;
        } catch {
            return null;
        }
    };

    // Auto-switch to analysis tab when analysis completes
    useEffect(() => {
        if (selectedGameId && selectedGame === null && latestGame?.id) {
            localStorage.removeItem('activeGameId');
            setSelectedGameId(null);
        }
    }, [selectedGameId, selectedGame, latestGame?.id]);

    const activeGame = selectedGame || latestGame;

    // Separate query to observe analysisLog changes - useLiveQuery doesn't track nested changes well
    const analysisLog = useLiveQuery(async () => {
        if (!activeGame?.id) return null;
        const game = await db.games.get(activeGame.id);
        return game?.analysisLog || null;
    }, [activeGame?.id]);

    useEffect(() => {
        if (activeGame?.analyzed) {
            setActiveTab('analysis');
        } else {
            setActiveTab('moves');
        }
    }, [activeGame?.analyzed, activeGame?.id]);

    useEffect(() => {
        if (activeTab !== 'analysis') setHoverArrow(null);
    }, [activeTab]);

    useEffect(() => {
        if (activeTab !== 'analysis') setPreviewFen(null);
    }, [activeTab]);

    // AI Analysis Data
    const aiAnalysis = useLiveQuery(async () => {
        if (!activeGame?.id) return null;
        const record = await db.ai_analyses.where('gameId').equals(activeGame.id).first();
        return record ? record.raw_json : null;
    }, [activeGame?.id]);

    const [showAIModal, setShowAIModal] = useState(false);

    useEffect(() => {
        if (activeGame && aiAnalysis) {
            // If we have AI analysis, we can default to it, or just let user click.
        }
    }, [activeGame, aiAnalysis]);

    useEffect(() => {
        if (!boardContainerRef.current) return;
        const resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                if (entry.contentRect) {
                    const width = Math.floor(entry.contentRect.width);
                    if (width > 0) {
                        setBoardWidth(width);
                    }
                }
            }
        });
        resizeObserver.observe(boardContainerRef.current);
        return () => resizeObserver.disconnect();
    }, [activeGame]);


    useEffect(() => {
        if (activeGame && activeGame.pgn) {
            // Only reset if it's a new game we haven't loaded yet
            if (loadedGameIdRef.current !== activeGame.id) {
                try {
                    const chess = new Chess();
                    chess.loadPgn(activeGame.pgn);

                    // Check for custom start position
                    const header = chess.header();
                    const initFen = header['FEN'] || 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
                    setStartFen(initFen);

                    const moves = chess.history({ verbose: true });
                    setHistory(moves);

                    // Support deep-linking from Smart Puzzles: jump to the puzzle start position.
                    let nextIndex = -1;
                    let usedJump = false;
                    const jumpGameIdRaw = Number(localStorage.getItem('activeGameJumpGameId'));
                    const jumpMoveIndexRaw = Number(localStorage.getItem('activeGameJumpMoveIndex'));
                    if (Number.isFinite(jumpGameIdRaw) && jumpGameIdRaw === activeGame.id && Number.isFinite(jumpMoveIndexRaw)) {
                        nextIndex = Math.max(-1, Math.min(moves.length - 1, jumpMoveIndexRaw));
                        usedJump = true;
                        localStorage.removeItem('activeGameJumpGameId');
                        localStorage.removeItem('activeGameJumpMoveIndex');
                    }

                    if (!usedJump) {
                        const savedIndex = loadSavedMoveIndex(activeGame.id, moves.length - 1);
                        if (Number.isFinite(savedIndex)) nextIndex = savedIndex;
                    }
                    setMoveIndex(nextIndex);

                    loadedGameIdRef.current = activeGame.id;
                } catch (e) {
                    console.error("Invalid PGN in dashboard", e);
                }
            }
        }
    }, [activeGame]);

    useEffect(() => {
        if (!activeGame?.id) return;
        try {
            localStorage.setItem(`${DASHBOARD_STATE_PREFIX}${activeGame.id}`, JSON.stringify({
                moveIndex
            }));
        } catch {
            // Ignore persistence errors
        }
    }, [activeGame?.id, moveIndex]);

    const handleNext = () => {
        if (moveIndex < history.length - 1) {
            setMoveIndex(moveIndex + 1);
        }
    };

    const handlePrev = () => {
        if (moveIndex >= 0) {
            setMoveIndex(moveIndex - 1);
        }
    };

    const handleStart = () => {
        setMoveIndex(-1);
    };

    const handleEnd = () => {
        setMoveIndex(history.length - 1);
    };

    const handleStockfishAnalyze = async () => {
        if (!activeGame) return;
        // Reset to pending to trigger queue
        await db.games.update(activeGame.id, { analyzed: false, analysisStatus: 'pending' });
    };

    const handleAnalyzePrimary = async () => {
        if (!activeGame) return;
        if (lastAnalyzeMode === 'ai') {
            if (aiAnalysis) {
                setActiveTab('ai');
                return;
            }
            setShowAIModal(true);
            return;
        }
        await handleStockfishAnalyze();
    };

    const handleAnalyzeSelect = async (mode) => {
        setLastAnalyzeMode(mode);
        localStorage.setItem('dashboardAnalyzeMode', mode);
        setAnalysisMenuOpen(false);
        if (mode === 'ai') {
            setShowAIModal(true);
            return;
        }
        await handleStockfishAnalyze();
    };

    const handleJumpTo = (index) => {
        setMoveIndex(index);
    };

    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'ArrowLeft') {
                handlePrev();
            } else if (e.key === 'ArrowRight') {
                handleNext();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }); // Intentionally no dep array so it uses latest closures for handleNext/Prev

    // DERIVE BOARD STATE: Robust derivation with start position support
    const currentFen = useMemo(() => {
        try {
            // Initialize with the correct starting position
            const chess = new Chess(startFen);

            if (moveIndex > -1 && history.length > 0) {
                for (let i = 0; i <= moveIndex; i++) {
                    const move = history[i];
                    if (move) {
                        const result = chess.move({
                            from: move.from,
                            to: move.to,
                            promotion: move.promotion
                        });
                        if (!result) console.error("Failed to apply move:", move.san, "at index", i);
                    }
                }
            }
            return chess.fen();
        } catch (e) {
            console.error("Error generating FEN:", e);
            return startFen;
        }
    }, [moveIndex, history, startFen]);

    const heroUser = useMemo(() => localStorage.getItem('heroUser'), []);
    const getSafeName = (value) => {
        if (!value) return '?';
        if (typeof value === 'string') return value;
        return value.name || '?';
    };

    // Determine orientation: If hero is Black, flip board. Default to White.
    const boardOrientation = useMemo(() => {
        if (!activeGame || !heroUser) return 'white';
        // Case insensitive check
        if (getSafeName(activeGame.black).toLowerCase() === heroUser.toLowerCase()) return 'black';
        return 'white';
    }, [activeGame, heroUser]);

    useEffect(() => {
        // Scroll active move into view
        if (moveIndex >= 0) {
            const el = document.getElementById(`move-${moveIndex}`);
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }, [moveIndex]);

    const getMeta = (key) => {
        if (!activeGame) return '?';
        if (activeGame[key]) return getSafeName(activeGame[key]);
        const match = activeGame.pgn && activeGame.pgn.match(new RegExp(`\\[${key} "(.+?)"\\]`));
        return match ? match[1] : '?';
    };

    const getTitleTag = (tag) => {
        if (!activeGame?.pgn) return '';
        const match = activeGame.pgn.match(new RegExp(`\\[${tag} "([^"]*)"\\]`));
        const value = match ? match[1] : '';
        if (!value || value === '?' || value === '-') return '';
        return value.trim();
    };

    const whiteTitle = (activeGame?.whiteTitle || getTitleTag('WhiteTitle')) || '';
    const blackTitle = (activeGame?.blackTitle || getTitleTag('BlackTitle')) || '';

    // Derived metadata for Top (Opponent) vs Bottom (Hero)
    const topPlayer = boardOrientation === 'white' ?
        { name: getMeta('Black'), rating: getMeta('BlackElo') || getMeta('blackRating'), title: blackTitle } :
        { name: getMeta('White'), rating: getMeta('WhiteElo') || getMeta('whiteRating'), title: whiteTitle };

    const bottomPlayer = boardOrientation === 'white' ?
        { name: getMeta('White'), rating: getMeta('WhiteElo') || getMeta('whiteRating'), title: whiteTitle } :
        { name: getMeta('Black'), rating: getMeta('BlackElo') || getMeta('blackRating'), title: blackTitle };

    const defaultArrow = useMemo(() => {
        // Show best move arrow when analysis data is available, regardless of active tab
        if (previewFen) return null;
        if (!analysisLog || analysisLog.length === 0) return null;

        const fenKey = (fen) => (typeof fen === 'string' ? fen.split(' ').slice(0, 4).join(' ') : '');
        const targetFen = currentFen;
        const key = fenKey(targetFen);

        // Prefer the analysis entry that matches the current board position.
        let entry = key ? analysisLog.find((e) => fenKey(e?.fen) === key) : null;
        if (!entry) {
            // Fallback: for a board showing "after moveIndex", use the next entry's pre-move analysis when possible.
            if (moveIndex >= 0) {
                entry = analysisLog[moveIndex + 1] || analysisLog[moveIndex] || null;
            } else {
                entry = analysisLog[0] || null;
            }
        }

        const uci = entry?.bestMove;
        if (!uci || typeof uci !== 'string' || uci.length < 4) return null;
        return { from: uci.substring(0, 2), to: uci.substring(2, 4) };
    }, [previewFen, analysisLog, moveIndex, currentFen]);

    const chessboardOptions = useMemo(() => {
        const arrow = hoverArrow || defaultArrow;
        return {
            id: "dashboard-board",
            position: previewFen || currentFen,
            boardWidth: boardWidth || 500,
            boardOrientation: boardOrientation,
            allowDragging: false,
            animationDurationInMs: 300,
            arrows: arrow ? [{ startSquare: arrow.from, endSquare: arrow.to, color: 'rgba(245, 200, 75, 0.95)' }] : [],
            darkSquareStyle: { backgroundColor: '#475569' },
            lightSquareStyle: { backgroundColor: '#e2e8f0' }
        };
    }, [currentFen, previewFen, boardWidth, boardOrientation, hoverArrow, defaultArrow]);

    const evalCp = useMemo(() => {
        if (!analysisLog || analysisLog.length === 0) return 0;
        const fenKey = (fen) => (typeof fen === 'string' ? fen.split(' ').slice(0, 4).join(' ') : '');
        const targetFen = previewFen || currentFen;
        const key = fenKey(targetFen);
        const matched = key ? analysisLog.find((e) => fenKey(e?.fen) === key) : null;
        const idx = matched ? analysisLog.indexOf(matched) : Math.min(Math.max(0, moveIndex + 1), analysisLog.length - 1);
        const entry = analysisLog[idx];
        if (!entry) return 0;
        const raw = typeof entry.score === 'number' ? entry.score : Number(entry.score);
        const score = Number.isFinite(raw) ? raw : 0;
        if (entry.scorePov === 'white') return score;
        return entry.turn === 'w' ? score : -score;
    }, [analysisLog, moveIndex, currentFen, previewFen]);

    const evalMate = useMemo(() => {
        if (!analysisLog || analysisLog.length === 0) return null;
        const fenKey = (fen) => (typeof fen === 'string' ? fen.split(' ').slice(0, 4).join(' ') : '');
        const targetFen = previewFen || currentFen;
        const key = fenKey(targetFen);
        const entry = key ? analysisLog.find((e) => fenKey(e?.fen) === key) : null;
        const idx = entry ? analysisLog.indexOf(entry) : Math.min(Math.max(0, moveIndex + 1), analysisLog.length - 1);
        const e = analysisLog[idx];
        if (!e) return null;

        // Prefer the explicit mate stored on the log entry (newer analyses store mate as white POV).
        if (typeof e.mate === 'number') return e.mate;

        // Back-compat / PV-only mate: if the best line is a forced mate, reflect it in the bar.
        const bestLine = Array.isArray(e.pvLines) && e.pvLines.length > 0 ? e.pvLines[0] : null;
        const mateRaw = bestLine && typeof bestLine.mate === 'number' ? bestLine.mate : null;
        if (typeof mateRaw !== 'number') return null;
        if (bestLine.scorePov === 'white' || e.scorePov === 'white') return mateRaw;
        // Older PV lines may be side-to-move POV.
        return e.turn === 'w' ? mateRaw : -mateRaw;
    }, [analysisLog, moveIndex, currentFen, previewFen]);

    const evalText = useMemo(() => {
        if (typeof evalMate === 'number') {
            const abs = Math.abs(evalMate);
            return `${evalMate < 0 ? '-' : ''}M${abs}`;
        }
        const pawns = (evalCp / 100).toFixed(2);
        return `${evalCp >= 0 ? '+' : ''}${pawns}`;
    }, [evalCp, evalMate]);

    const evalPct = useMemo(() => {
        if (typeof evalMate === 'number') return evalMate > 0 ? 1 : 0;
        // Map centipawns to a 0..1 "white share" using an arctan curve.
        // This avoids saturating the bar too quickly (e.g. +10.0 should not look "full mate").
        const cp = Math.max(-10000, Math.min(10000, evalCp));
        const scale = 600; // ~6 pawns -> ~75% bar fill
        return 0.5 + Math.atan(cp / scale) / Math.PI;
    }, [evalCp, evalMate]);

    const evalMarkerTopPct = useMemo(() => {
        const raw = (1 - evalPct) * 100;
        // Keep the pill/marker comfortably inside the rail.
        return Math.max(2, Math.min(98, raw));
    }, [evalPct]);

    const uciToSan = (fen, uci) => {
        if (!fen || !uci || uci.length < 4) return uci || '-';
        try {
            const chess = new Chess(fen);
            const from = uci.substring(0, 2);
            const to = uci.substring(2, 4);
            const promotion = uci.length > 4 ? uci.substring(4, 5) : undefined;
            const res = chess.move({ from, to, promotion });
            return res?.san || uci;
        } catch {
            return uci;
        }
    };

    const moveInsight = useMemo(() => {
        if (!analysisLog || analysisLog.length === 0) return null;
        const fenKey = (fen) => (typeof fen === 'string' ? fen.split(' ').slice(0, 4).join(' ') : '');
        const key = fenKey(currentFen);
        let entry = key ? analysisLog.find((e) => fenKey(e?.fen) === key) : null;
        if (!entry) {
            if (moveIndex >= 0) entry = analysisLog[moveIndex] || null;
            else entry = analysisLog[0] || null;
        }
        return entry;
    }, [analysisLog, currentFen, moveIndex]);

    const classificationBadge = useMemo(() => {
        if (!analysisLog || moveIndex < 0) return null;
        const entry = analysisLog[moveIndex];
        if (!entry) return null;

        const map = {
            book: { label: 'B', tone: 'book' },
            brilliant: { label: '!!', tone: 'brilliant' },
            great: { label: '!', tone: 'great' },
            best: { label: '★', tone: 'best' },
            good: { label: '✓', tone: 'good' },
            inaccuracy: { label: '?!', tone: 'inaccuracy' },
            mistake: { label: '?', tone: 'mistake' },
            blunder: { label: '??', tone: 'blunder' }
        };

        // Back-compat: show Book badge even if older analysis kept `classification` as best/good.
        if (entry.bookMove) return map.book;
        return map[entry.classification] || null;
    }, [analysisLog, moveIndex]);

    useLayoutEffect(() => {
        if (!classificationBadge || moveIndex < 0 || !history[moveIndex]?.to) {
            setBadgeStyle(null);
            return;
        }
        if (previewFen) {
            // When previewing a PV step, the board is no longer aligned to the "current move" badge.
            setBadgeStyle(null);
            return;
        }

        const square = history[moveIndex].to;
        const root = boardContainerRef.current;
        if (root) {
            const el = root.querySelector(`[data-square="${square}"]`);
            if (el) {
                const rootRect = root.getBoundingClientRect();
                const rect = el.getBoundingClientRect();
                setBadgeStyle({
                    left: Math.round(rect.left - rootRect.left + rect.width - 26 + 2),
                    top: Math.round(rect.top - rootRect.top + 2)
                });
                return;
            }
        }

        // Fallback: math-based placement (square top-right)
        const file = square.charCodeAt(0) - 97;
        const rank = parseInt(square[1], 10) - 1;
        const size = (boardWidth || 500) / 8;

        let x = file;
        let y = 7 - rank;
        if (boardOrientation === 'black') {
            x = 7 - file;
            y = rank;
        }
        setBadgeStyle({
            left: Math.round(x * size + size - 26 + 2),
            top: Math.round(y * size + 2)
        });
    }, [classificationBadge, history, moveIndex, boardWidth, boardOrientation, previewFen]);

    // Close menu only via toggle or selection (avoid click-outside issues on small screens).

    if (!stats) return <div className="p-8 text-secondary">Loading dashboard...</div>;

    return (
        <div className={`dashboard-shell bg-app ${rightPanelOpen ? '' : 'dashboard-shell--collapsed'}`}>

            {/* LEFT / CENTER: Chessboard Area */}
            <div className="dashboard-center flex flex-col min-w-0 relative">
                {/* Added w-full to ensure this container takes width */}
                {/* Main Board Area */}
                <div className="dashboard-board-area flex-1 flex flex-col items-center justify-start min-h-0 w-full p-4">

                    {activeGame && (
                        <div className="board-header">
                            <div className="board-header__left">
                                <div className="board-header__meta">
                                    <span className="board-meta-pill">{getMeta('perf')}</span>
                                    <span className="board-meta-sep">•</span>
                                    <span>{new Date(activeGame.date).toLocaleDateString()}</span>
                                    <span className="board-meta-sep">•</span>
                                    <span>{activeGame.result}</span>
                                </div>
                                <div className="board-header__opening">
                                    <span className="opening-name">{activeGame.openingName || activeGame.eco || 'Unknown Opening'}</span>
                                    {activeGame.eco && <span className="opening-eco">{activeGame.eco}</span>}
                                </div>
                            </div>
                            <div className="board-header__actions">
                                {activeGame && (
                                    <div className="split-button">
                                        <button
                                            onClick={handleAnalyzePrimary}
                                            disabled={activeGame.analysisStatus === 'analyzing'}
                                            className={`split-button__main ${activeGame.analysisStatus === 'analyzing' ? 'is-loading' : ''}`}
                                        >
                                            <Zap size={14} className={activeGame.analysisStatus === 'analyzing' ? 'animate-pulse' : ''} />
                                            {lastAnalyzeMode === 'ai'
                                                ? (aiAnalysis ? 'Open AI Coach' : 'Analyze (AI)')
                                                : (activeGame.analysisStatus === 'analyzing'
                                                    ? 'Analyzing...'
                                                    : (activeGame.analysisStatus === 'failed'
                                                        ? 'Retry Analysis (Stockfish)'
                                                        : (activeGame.analyzed ? 'Re-analyze (Stockfish)' : 'Analyze (Stockfish)')))}
                                        </button>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setAnalysisMenuOpen((v) => !v);
                                            }}
                                            className="split-button__toggle"
                                            aria-label="Choose analysis mode"
                                        >
                                            <ChevronDown size={14} />
                                        </button>
                                        {analysisMenuOpen && (
                                            <div className="split-button__menu" onClick={(e) => e.stopPropagation()}>
                                                <button onClick={() => handleAnalyzeSelect('stockfish')}>
                                                    {activeGame.analyzed ? 'Re-analyze (Stockfish)' : 'Stockfish Analysis'}
                                                </button>
                                                <button onClick={() => handleAnalyzeSelect('ai')}>
                                                    {aiAnalysis ? 'Re-run AI Analysis' : 'AI Analysis'}
                                                </button>
                                                {aiAnalysis && (
                                                    <button onClick={() => {
                                                        setLastAnalyzeMode('ai');
                                                        localStorage.setItem('dashboardAnalyzeMode', 'ai');
                                                        setAnalysisMenuOpen(false);
                                                        setActiveTab('ai');
                                                    }}>
                                                        Open AI Coach
                                                    </button>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )}
                                <button
                                    onClick={() => setRightPanelOpen((v) => !v)}
                                    className="panel-toggle"
                                >
                                    {rightPanelOpen ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
                                    {rightPanelOpen ? 'Hide Panel' : 'Show Panel'}
                                </button>
                            </div>
                        </div>
                    )}

                    {activeGame ? (
                        <div className="board-wrap flex flex-col gap-1 shrink-0">
                            {/* Top Player */}
                            <div className="flex justify-between items-end px-1">
                                <div className="flex items-baseline gap-2 text-secondary">
                                    {topPlayer.title && <span className="title-badge">{topPlayer.title}</span>}
                                    <span className="font-semibold">{topPlayer.name}</span>
                                    <span className="text-sm font-light">({topPlayer.rating})</span>
                                </div>
                                <div className="text-xs text-muted/50">{boardOrientation === 'white' ? 'Black' : 'White'}</div>
                            </div>

                            {/* BOARD + EVAL BAR */}
                            <div className="board-row" style={{ position: 'relative', zIndex: 2 }}>
                                <div
                                    ref={boardContainerRef}
                                    className="board-shell relative aspect-square w-full shadow-2xl rounded-lg bg-panel border overflow-hidden mx-auto"
                                >
                                    <Chessboard options={chessboardOptions} />
                                    {badgeStyle && classificationBadge && (
                                        <div
                                            className={`board-badge badge-${classificationBadge.tone}`}
                                            style={{ left: badgeStyle.left, top: badgeStyle.top }}
                                        >
                                            {classificationBadge.label}
                                        </div>
                                    )}
                                </div>
                                <div className="eval-rail eval-rail--interactive" title={`Evaluation: ${evalText}`} aria-hidden="true">
                                    <div className="eval-bar eval-bar--outside">
                                        <div className="eval-bar__black" style={{ height: `${Math.round((1 - evalPct) * 100)}%` }} />
                                        <div className="eval-bar__white" style={{ height: `${Math.round(evalPct * 100)}%` }} />
                                        <div className="eval-bar__mid" />
                                        <div className="eval-bar__marker" style={{ top: `${evalMarkerTopPct}%` }} />
                                    </div>
                                    <div className="eval-rail__value" style={{ top: `${evalMarkerTopPct}%` }}>
                                        {evalText}
                                    </div>
                                </div>
                            </div>

                            {/* Bottom Player */}
                            <div className="flex justify-between items-start px-1">
                                <div className="flex items-baseline gap-2 text-primary">
                                    {bottomPlayer.title && <span className="title-badge">{bottomPlayer.title}</span>}
                                    <span className="font-bold text-lg">{bottomPlayer.name}</span>
                                    <span className="text-sm font-light">({bottomPlayer.rating})</span>
                                </div>
                                <div className="text-xs text-muted/50">{boardOrientation === 'white' ? 'White' : 'Black'}</div>
                            </div>
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center p-12 border-2 border-dashed border-white/10 rounded-xl">
                            <Activity size={48} className="text-muted mb-4" />
                            <h3 className="text-lg font-medium text-primary">No game selected</h3>
                            <p className="text-secondary text-center mb-6 max-w-xs">Import a game PGN to start analyzing your moves.</p>
                            <Link to="/import" className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-full font-medium transition-colors">
                                Import Game
                            </Link>
                        </div>
                    )}

                    {/* Controls */}
                    <div className="board-wrap flex items-center justify-center gap-4 w-full py-4 shrink-0">
                        <button onClick={handleStart} className="p-2 hover:bg-subtle rounded-full text-secondary transition-colors" title="Start"><Rewind size={20} fill="currentColor" /></button>
                        <button onClick={handlePrev} className="p-3 hover:bg-subtle rounded-full text-primary transition-colors bg-subtle border" title="Previous"><ChevronLeft size={24} /></button>
                        <button onClick={handleNext} className="p-3 hover:bg-subtle rounded-full text-primary transition-colors bg-subtle border" title="Next"><ChevronRight size={24} /></button>
                        <button onClick={handleEnd} className="p-2 hover:bg-subtle rounded-full text-secondary transition-colors" title="End"><FastForward size={20} fill="currentColor" /></button>
                    </div>

                    {!rightPanelOpen && (
                        <button className="panel-toggle panel-toggle--floating" onClick={() => setRightPanelOpen(true)}>
                            <ChevronLeft size={16} />
                            Show Panel
                        </button>
                    )}

                    {showAIModal && activeGame && (
                        <div className="absolute inset-0 flex items-center justify-center p-4" style={{ zIndex: 9999 }}>
                            <AIAnalysisModal
                                game={activeGame}
                                onClose={() => setShowAIModal(false)}
                                onAnalysisComplete={() => {
                                    setActiveTab('ai');
                                }}
                            />
                        </div>
                    )}
                </div>
            </div>



            {/* RIGHT: Context Panel (Move List + Stats) */}
            <div className="dashboard-side bg-panel border-l flex flex-col shrink-0 overflow-hidden">

                {/* 1. Right Panel Content (Moves or Analytics) */}
                <div className="flex-1 flex flex-col min-h-0 relative">
                    {/* Tab Header */}
                    <div className="flex items-center border-b bg-subtle/50 shrink-0">
                        <button
                            onClick={() => setActiveTab('moves')}
                            className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider transition-colors ${activeTab === 'moves' ? 'text-primary bg-panel border-b-2 border-primary' : 'text-muted hover:text-secondary'}`}
                        >
                            Moves
                        </button>
                        <button
                            onClick={() => setActiveTab('analysis')}
                            disabled={!(analysisLog && analysisLog.length > 0)}
                            className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider transition-colors ${activeTab === 'analysis' ? 'text-primary bg-panel border-b-2 border-primary' : 'text-muted hover:text-secondary disabled:opacity-50 disabled:cursor-not-allowed'}`}
                        >
                            Analytics
                        </button>
                        <button
                            onClick={() => setActiveTab('ai')}
                            disabled={!aiAnalysis}
                            className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider transition-colors ${activeTab === 'ai' ? 'text-primary bg-panel border-b-2 border-primary' : 'text-muted hover:text-secondary disabled:opacity-50 disabled:cursor-not-allowed'}`}
                        >
                            <span className={!aiAnalysis ? 'opacity-50' : 'text-purple-400'}>AI Coach</span>
                        </button>
                    </div>

                    {/* Scrollable Content Area */}
                    <div className="flex-1 overflow-y-auto min-h-0 bg-panel relative">
                        {activeTab === 'ai' ? (
                            <AIInsightsView
                                analysis={aiAnalysis}
                                onJumpToMove={(moveIdx) => {
                                    /* 
                                      The prompt asks for move_number (1-based). 
                                      However, the history array is 0-based ply.
                                      Wait, history is 0-based *move objects*.
                                      Let's assume onJumpToMove from View passes 0-based full-move index.
                                      Actually, let's verify what `handleJumpTo` expects. 
                                      handleJumpTo(index) sets moveIndex. 
                                      history array length = ply count.
                                      So if we click "White Move 1", that is ply 0.
                                      If we click "Black Move 1", that is ply 1.
                                      
                                      The AIInsightsView implementation I wrote earlier: 
                                      onClick={() => onJumpToMove && onJumpToMove(moment.move_number - 1)}
                                      BUT wait, move_number 1 (White) is ply 0.
                                      move_number 1 (Black) is ply 1.
                                      The view needs to differentiate side.
                                      Correct, my view implementation: 
                                      onClick={() => onJumpToMove && onJumpToMove(move.side === 'white' ? (move.move_number - 1)*2 : (move.move_number - 1)*2 + 1)}
                                      This seems correct for mapping to ply index.
                                    */
                                    handleJumpTo(moveIdx);
                                }}
                            />
                        ) : activeTab === 'analysis' ? (
                            (analysisLog && analysisLog.length > 0) ? (
                                <AnalyticsPanel
                                    game={{ ...activeGame, analysisLog }}
                                    onJumpToMove={handleJumpTo}
                                    activeIndex={moveIndex}
                                    onBestHover={(uci, fen) => {
                                        if (!uci || typeof uci !== 'string' || uci.length < 4) {
                                            setHoverArrow(null);
                                            return;
                                        }
                                        const from = uci.substring(0, 2);
                                        const to = uci.substring(2, 4);
                                        setHoverArrow({ from, to });
                                    }}
                                    onPreviewFen={(fen) => setPreviewFen(fen)}
                                />
                            ) : (
                                <div className="p-8 text-center text-muted">
                                    Analysis not available yet. Run analysis to unlock move quality and evaluation insights.
                                </div>
                            )
                        ) : (
                            /* Move List Grid */
                            <div className="move-list text-sm">
                                <div className="move-row move-header">
                                    <div className="move-num text-muted">#</div>
                                    <div className="move-cell move-cell-white text-muted">White</div>
                                    <div className="move-cell move-cell-black text-muted">Black</div>
                                </div>
                                {history.reduce((rows, move, i) => {
                                    if (i % 2 === 0) {
                                        rows.push([move]);
                                    } else {
                                        rows[rows.length - 1].push(move);
                                    }
                                    return rows;
                                }, []).map((pair, rowIdx) => {
                                    const whiteMove = pair[0];
                                    const blackMove = pair[1];
                                    const whiteIndex = rowIdx * 2;
                                    const blackIndex = rowIdx * 2 + 1;
                                    return (
                                        <div key={rowIdx} className={`move-row ${rowIdx % 2 === 0 ? 'move-row-even' : 'move-row-odd'}`}>
                                            <div className="move-num text-muted">{rowIdx + 1}</div>
                                            <button
                                                id={`move-${whiteIndex}`}
                                                onClick={() => handleJumpTo(whiteIndex)}
                                                className={`move-cell move-cell-white ${moveIndex === whiteIndex ? 'move-cell-active' : ''}`}
                                            >
                                                {whiteMove?.san || '-'}
                                            </button>
                                            <button
                                                id={`move-${blackIndex}`}
                                                onClick={() => handleJumpTo(blackIndex)}
                                                disabled={!blackMove}
                                                className={`move-cell move-cell-black ${moveIndex === blackIndex ? 'move-cell-active' : ''}`}
                                            >
                                                {blackMove?.san || '-'}
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>

                {/* 2. Stats (Bottom Half) - Only show in Moves view */}
                {activeTab === 'moves' && (
                    <div className="dashboard-performance flex flex-col bg-panel/50 border-t shrink-0">
                        <div className="p-4 border-b sticky top-0 bg-panel z-10">
                            <h2 className="text-sm font-semibold text-primary">Move Insights</h2>
                        </div>

                        <div className="performance-scroll p-4 flex flex-col gap-2">
                            {moveInsight ? (
                                <>
                                    <StatRow label="Classification" value={moveInsight.classification || '-'} subtext="Move quality" icon={Target} color="blue" />
                                    <StatRow label="Eval Swing" value={typeof moveInsight.evalDiff === 'number' ? `${Math.round(moveInsight.evalDiff)}cp` : '-'} subtext="Centipawn loss" icon={Activity} color="orange" />
                                    <StatRow label="Best Move" value={uciToSan(moveInsight.fen, moveInsight.bestMove) || '-'} subtext="Engine recommendation" icon={Zap} color="yellow" />
                                    <StatRow label="Your Move" value={uciToSan(moveInsight.fen, moveInsight.move) || '-'} subtext="Played move" icon={ArrowUpRight} color="green" />
                                </>
                            ) : (
                                <div className="text-sm text-muted">Move analysis not available yet.</div>
                            )}
                        </div>

                    </div>
                )}
            </div>
        </div>
    );
};
