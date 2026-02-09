import React, { useLayoutEffect, useState, useEffect, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../services/db';
import { Chessboard } from 'react-chessboard';
import { ArrowUpRight, Activity, Target, Zap, ChevronLeft, ChevronRight, Play, FastForward, Rewind, AlertCircle, BookOpen, Search } from 'lucide-react';
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

        all.forEach(g => {
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
            total: all.length,
            wins,
            winRate: Math.round((wins / all.length) * 100),
            accuracy: analyzedCount ? Math.round(totalAccuracy / analyzedCount) : 0,
            avgCpLoss: cpCount ? Math.round(totalCpLoss / cpCount) : 0,
            maxStreak,
            maxSwing,
            bookMoves,
            bookTotal
        };
    });

    const queueCount = useLiveQuery(() => db.games.filter(g => g.analysisStatus === 'pending' || (!g.analyzed && !g.analysisStatus)).count());
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

    // Auto-switch to analysis tab when analysis completes
    useEffect(() => {
        if (selectedGameId && selectedGame === null && latestGame?.id) {
            localStorage.removeItem('activeGameId');
            setSelectedGameId(null);
        }
    }, [selectedGameId, selectedGame, latestGame?.id]);

    const activeGame = selectedGame || latestGame;

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

                    // Support deep-linking from Smart Reels: jump to the puzzle start position.
                    let nextIndex = -1;
                    const jumpGameIdRaw = Number(localStorage.getItem('activeGameJumpGameId'));
                    const jumpMoveIndexRaw = Number(localStorage.getItem('activeGameJumpMoveIndex'));
                    if (Number.isFinite(jumpGameIdRaw) && jumpGameIdRaw === activeGame.id && Number.isFinite(jumpMoveIndexRaw)) {
                        nextIndex = Math.max(-1, Math.min(moves.length - 1, jumpMoveIndexRaw));
                        localStorage.removeItem('activeGameJumpGameId');
                        localStorage.removeItem('activeGameJumpMoveIndex');
                    }
                    setMoveIndex(nextIndex);

                    loadedGameIdRef.current = activeGame.id;
                } catch (e) {
                    console.error("Invalid PGN in dashboard", e);
                }
            }
        }
    }, [activeGame]);

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

    const handleAnalyze = async () => {
        if (!activeGame) return;
        if (aiAnalysis) {
            setActiveTab('ai');
        } else {
            setShowAIModal(true);
        }
    };

    const handleStockfishAnalyze = async () => {
        if (!activeGame) return;
        // Reset to pending to trigger queue
        await db.games.update(activeGame.id, { analyzed: false, analysisStatus: 'pending' });
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

    // Derived metadata for Top (Opponent) vs Bottom (Hero)
    const topPlayer = boardOrientation === 'white' ?
        { name: getMeta('Black'), rating: getMeta('BlackElo') || getMeta('blackRating') } :
        { name: getMeta('White'), rating: getMeta('WhiteElo') || getMeta('whiteRating') };

    const bottomPlayer = boardOrientation === 'white' ?
        { name: getMeta('White'), rating: getMeta('WhiteElo') || getMeta('whiteRating') } :
        { name: getMeta('Black'), rating: getMeta('BlackElo') || getMeta('blackRating') };

    const defaultArrow = useMemo(() => {
        if (activeTab !== 'analysis') return null;
        if (previewFen) return null;
        if (!activeGame?.analysisLog || moveIndex < 0) return null;
        const entry = activeGame.analysisLog[moveIndex];
        const uci = entry?.bestMove;
        if (!uci || typeof uci !== 'string' || uci.length < 4) return null;
        return { from: uci.substring(0, 2), to: uci.substring(2, 4) };
    }, [activeTab, previewFen, activeGame?.analysisLog, moveIndex]);

    const chessboardOptions = useMemo(() => ({
        id: "dashboard-board",
        position: previewFen || currentFen,
        boardWidth: boardWidth || 500,
        boardOrientation: boardOrientation,
        arePiecesDraggable: false,
        animationDuration: 300,
        customArrows: (hoverArrow || defaultArrow) ? [[(hoverArrow || defaultArrow).from, (hoverArrow || defaultArrow).to, 'rgba(245, 200, 75, 0.95)']] : [],
        customDarkSquareStyle: { backgroundColor: '#475569' },
        customLightSquareStyle: { backgroundColor: '#e2e8f0' }
    }), [currentFen, previewFen, boardWidth, boardOrientation, hoverArrow, defaultArrow]);

    const evalCp = useMemo(() => {
        if (!activeGame?.analysisLog || activeGame.analysisLog.length === 0) return 0;
        const fenKey = (fen) => (typeof fen === 'string' ? fen.split(' ').slice(0, 4).join(' ') : '');
        const targetFen = previewFen || currentFen;
        const key = fenKey(targetFen);
        const matched = key ? activeGame.analysisLog.find((e) => fenKey(e?.fen) === key) : null;
        const idx = matched ? activeGame.analysisLog.indexOf(matched) : Math.min(Math.max(0, moveIndex + 1), activeGame.analysisLog.length - 1);
        const entry = activeGame.analysisLog[idx];
        if (!entry) return 0;
        const raw = typeof entry.score === 'number' ? entry.score : Number(entry.score);
        const score = Number.isFinite(raw) ? raw : 0;
        if (entry.scorePov === 'white') return score;
        return entry.turn === 'w' ? score : -score;
    }, [activeGame?.analysisLog, moveIndex, currentFen, previewFen]);

    const evalMate = useMemo(() => {
        if (!activeGame?.analysisLog || activeGame.analysisLog.length === 0) return null;
        const fenKey = (fen) => (typeof fen === 'string' ? fen.split(' ').slice(0, 4).join(' ') : '');
        const targetFen = previewFen || currentFen;
        const key = fenKey(targetFen);
        const entry = key ? activeGame.analysisLog.find((e) => fenKey(e?.fen) === key) : null;
        const idx = entry ? activeGame.analysisLog.indexOf(entry) : Math.min(Math.max(0, moveIndex + 1), activeGame.analysisLog.length - 1);
        const e = activeGame.analysisLog[idx];
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
    }, [activeGame?.analysisLog, moveIndex, currentFen, previewFen]);

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

    const classificationBadge = useMemo(() => {
        if (!activeGame?.analysisLog || moveIndex < 0) return null;
        const entry = activeGame.analysisLog[moveIndex];
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
    }, [activeGame?.analysisLog, moveIndex]);

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

    if (!stats) return <div className="p-8 text-secondary">Loading dashboard...</div>;

    return (
        <div className="dashboard-shell bg-app">

            {/* LEFT / CENTER: Chessboard Area */}
            <div className="dashboard-center flex flex-col min-w-0 overflow-y-auto relative">
                {/* Added w-full to ensure this container takes width */}
                {/* Main Board Area */}
                <div className="flex-1 flex flex-col items-center justify-center min-h-0 w-full p-4">

                    {/* Game Header (Date/Result) */}
                    {activeGame && (
                        <div className="text-xs text-secondary flex items-center justify-center gap-3 mb-2 shrink-0">
                            <span className="uppercase tracking-wider font-semibold">{getMeta('perf')}</span>
                            <span>•</span>
                            <span>{new Date(activeGame.date).toLocaleDateString()}</span>
                            <span>•</span>
                            <span>{activeGame.result}</span>
                        </div>
                    )}

                    {activeGame ? (
                        <div className="board-wrap flex flex-col gap-1 shrink-0">
                            {/* Top Player */}
                            <div className="flex justify-between items-end px-1">
                                <div className="flex items-baseline gap-2 text-secondary">
                                    <span className="font-semibold">{topPlayer.name}</span>
                                    <span className="text-sm font-light">({topPlayer.rating})</span>
                                </div>
                                <div className="text-xs text-muted/50">{boardOrientation === 'white' ? 'Black' : 'White'}</div>
                            </div>

                            {/* BOARD + EVAL BAR */}
                            <div className="board-row" style={{ position: 'relative', zIndex: 10 }}>
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
                                <div className="eval-rail" aria-hidden="true">
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
                        {activeGame && (
                            <button
                                onClick={handleStockfishAnalyze}
                                disabled={activeGame.analysisStatus === 'analyzing'}
                                className={`mr-4 flex items-left gap-4 px-4 py-2 rounded-full text-xs font-medium transition-colors ${activeGame.analysisStatus === 'analyzing' ? 'bg-blue-500/10 text-blue-400 cursor-wait' :
                                    activeGame.analysisStatus === 'failed' ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20' :
                                        activeGame.analyzed ? 'bg-subtle text-secondary hover:text-primary' :
                                            'bg-primary text-black hover:opacity-90'
                                    }`}
                            >
                                <Zap size={14} className={activeGame.analysisStatus === 'analyzing' ? 'animate-pulse' : ''} />
                                {activeGame.analysisStatus === 'analyzing' ? 'Analyzing...' :
                                    activeGame.analysisStatus === 'failed' ? 'Retry Analysis' :
                                        activeGame.analyzed ? 'Re-analyze' : 'Analyze'}
                            </button>
                        )}
                        <button onClick={handleStart} className="p-2 hover:bg-subtle rounded-full text-secondary transition-colors" title="Start"><Rewind size={20} fill="currentColor" /></button>
                        <button onClick={handlePrev} className="p-3 hover:bg-subtle rounded-full text-primary transition-colors bg-subtle border" title="Previous"><ChevronLeft size={24} /></button>
                        <button onClick={handleNext} className="p-3 hover:bg-subtle rounded-full text-primary transition-colors bg-subtle border" title="Next"><ChevronRight size={24} /></button>
                        <button onClick={handleEnd} className="p-2 hover:bg-subtle rounded-full text-secondary transition-colors" title="End"><FastForward size={20} fill="currentColor" /></button>

                        {activeGame && (
                            <button
                                onClick={handleAnalyze}
                                className={`ml-4 flex items-center gap-2 px-4 py-2 rounded-full text-xs font-medium transition-colors ${aiAnalysis ? 'bg-purple-500/10 text-purple-400 hover:bg-purple-500/20' :
                                    'bg-primary text-black hover:opacity-90'
                                    }`}
                            >
                                <Sparkles size={14} className={activeGame.analysisStatus === 'analyzing' ? 'animate-pulse' : ''} />
                                {aiAnalysis ? 'AI Insights' : 'Analyze with AI'}
                            </button>
                        )}
                    </div>

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
                            disabled={!(activeGame?.analysisLog && activeGame.analysisLog.length > 0)}
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
                            (activeGame?.analysisLog && activeGame.analysisLog.length > 0) ? (
                                <AnalyticsPanel
                                    game={activeGame}
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
                            <h2 className="text-sm font-semibold text-primary">Performance</h2>
                        </div>

                        <div className="performance-scroll p-4 flex flex-col gap-2">
                            <StatRow label="Games" value={stats.total} subtext="Total analyzed" icon={Activity} color="blue" />
                            <StatRow label="Win Rate" value={`${stats.winRate}%`} subtext="Recent trend" icon={ArrowUpRight} color="green" />
                            <StatRow label="Accuracy" value={stats.accuracy ? `${stats.accuracy}%` : '-'} subtext="Avg CP Loss" icon={Target} color="orange" />
                            <StatRow label="Avg CP Loss" value={stats.avgCpLoss ? `${stats.avgCpLoss}` : '-'} subtext="Lower is better" icon={Target} color="yellow" />
                            <StatRow label="Accuracy Streak" value={stats.maxStreak || '-'} subtext="Best streak (>=90%)" icon={Zap} color="green" />
                            <StatRow label="Max Swing" value={stats.maxSwing || '-'} subtext="Largest eval swing" icon={Activity} color="red" />
                            <StatRow label="Book Moves" value={stats.bookTotal ? `${Math.round((stats.bookMoves / stats.bookTotal) * 100)}%` : '-'} subtext="Opening moves in book" icon={BookOpen} color="blue" />
                            {queueCount > 0 && (
                                <StatRow label="Queue" value={queueCount} subtext="Pending analysis" icon={Zap} color="yellow" />
                            )}
                            {failedCount > 0 && (
                                <StatRow label="Failed" value={failedCount} subtext="Analysis errors" icon={AlertCircle} color="red" />
                            )}
                        </div>

                        <div className="p-4 mt-auto">
                            <div className="p-3 rounded-md bg-subtle border">
                                <div className="flex items-start gap-3">
                                    <Zap size={16} className="text-orange-400 mt-1 shrink-0" />
                                    <div>
                                        <h4 className="text-sm font-medium text-primary">Opening</h4>
                                        <p className="text-xs text-secondary mt-1 leading-relaxed">
                                            {activeGame?.openingName || activeGame?.eco || 'Unknown'}
                                        </p>
                                        <Link to="/openings" className="inline-flex items-center gap-1 text-xs text-blue-400 mt-3 font-medium hover:text-white">
                                            View Stats <ArrowUpRight size={12} />
                                        </Link>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
