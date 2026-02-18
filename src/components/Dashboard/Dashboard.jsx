import React, { useLayoutEffect, useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, saveGameContent } from '../../services/db';
import { Chessboard } from 'react-chessboard';
import { ArrowUpRight, Activity, Target, Zap, ChevronLeft, ChevronRight, FastForward, Rewind, ChevronDown, GripHorizontal } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Chess } from 'chess.js';
import { processGame } from '../../services/analyzer';
import { AnalyticsPanel } from './AnalyticsPanel';
import { AIAnalysisModal } from './AIAnalysisModal';
import { AIInsightsView } from './AIInsightsView';
import { Sparkles } from 'lucide-react';
import { useHeroProfiles } from '../../hooks/useHeroProfiles';
import { getHeroDisplayName, getHeroSideFromGame, isHeroGameForProfiles } from '../../services/heroProfiles';

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
    const BOARD_LIGHT_KEY = 'boardLightSquare';
    const BOARD_DARK_KEY = 'boardDarkSquare';
    const BOARD_FLASH_WHITE_KEY = 'boardFlashWhite';
    const BOARD_FLASH_BLACK_KEY = 'boardFlashBlack';
    const DEFAULT_BOARD_LIGHT = '#e2e8f0';
    const DEFAULT_BOARD_DARK = '#475569';
    const DEFAULT_FLASH_WHITE = '#D9C64A';
    const DEFAULT_FLASH_BLACK = '#D9C64A';
    const latestGame = useLiveQuery(() => db.games.orderBy('date').reverse().first());
    const totalGames = useLiveQuery(() => db.games.count());
    const [selectedGameId, setSelectedGameId] = useState(() => localStorage.getItem('activeGameId'));
    const [boardColors, setBoardColors] = useState(() => ({
        light: localStorage.getItem(BOARD_LIGHT_KEY) || DEFAULT_BOARD_LIGHT,
        dark: localStorage.getItem(BOARD_DARK_KEY) || DEFAULT_BOARD_DARK
    }));
    const [flashColors, setFlashColors] = useState(() => ({
        white: localStorage.getItem(BOARD_FLASH_WHITE_KEY) || DEFAULT_FLASH_WHITE,
        black: localStorage.getItem(BOARD_FLASH_BLACK_KEY) || DEFAULT_FLASH_BLACK
    }));
    const { activeProfiles } = useHeroProfiles();
    const profileKey = useMemo(() => activeProfiles.map((p) => p.id).join('|'), [activeProfiles]);
    const heroDisplayName = useMemo(() => getHeroDisplayName(activeProfiles), [activeProfiles]);

    useEffect(() => {
        const handleActiveChange = () => {
            setSelectedGameId(localStorage.getItem('activeGameId'));
        };
        window.addEventListener('activeGameChanged', handleActiveChange);
        return () => window.removeEventListener('activeGameChanged', handleActiveChange);
    }, []);

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

    const selectedGame = useLiveQuery(async () => {
        if (!selectedGameId) return null;
        const id = Number(selectedGameId);
        if (!id || Number.isNaN(id)) return null;
        return db.games.get(id);
    }, [selectedGameId]);

    const stats = useLiveQuery(async () => {
        const all = await db.games.toArray();
        if (!all.length || !activeProfiles.length) {
            return { total: 0, wins: 0, winRate: 0, accuracy: 0, avgCpLoss: 0, maxStreak: 0, maxSwing: 0 };
        }

        let wins = 0;
        let totalAccuracy = 0;
        let analyzedCount = 0;
        let totalCpLoss = 0;
        let cpCount = 0;
        let maxStreak = 0;
        let maxSwing = 0;
        const heroGames = all.filter((g) => isHeroGameForProfiles(g, activeProfiles));

        heroGames.forEach(g => {
            const heroSide = getHeroSideFromGame(g, activeProfiles);
            const isWhite = heroSide === 'white';
            const isBlack = heroSide === 'black';
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
        });

        return {
            total: heroGames.length,
            wins,
            winRate: heroGames.length ? Math.round((wins / heroGames.length) * 100) : 0,
            accuracy: analyzedCount ? Math.round(totalAccuracy / analyzedCount) : 0,
            avgCpLoss: cpCount ? Math.round(totalCpLoss / cpCount) : 0,
            maxStreak,
            maxSwing
        };
    });

    const queueCount = useLiveQuery(() => db.games.filter(g => g.analysisStatus === 'pending' || g.analysisStatus === 'idle' || (!g.analyzed && !g.analysisStatus)).count());
    const failedCount = useLiveQuery(() => db.games.filter(g => g.analysisStatus === 'failed').count());

    const [moveIndex, setMoveIndex] = useState(-1); // -1 = start
    const [history, setHistory] = useState([]);
    const [startFen, setStartFen] = useState('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    const [lastMoveFlash, setLastMoveFlash] = useState(0);

    // Track loaded game ID to prevent resetting when analysis updates the record
    const loadedGameIdRef = React.useRef(null);

    // Responsive board width
    const [boardWidth, setBoardWidth] = useState(500);
    const boardContainerRef = React.useRef(null);

    const [activeTab, setActiveTab] = useState('moves'); // 'moves' | 'analysis'
    const [hoverArrow, setHoverArrow] = useState(null); // { from, to }
    const [previewFen, setPreviewFen] = useState(null);
    const [badgeStyle, setBadgeStyle] = useState(null); // { left, top, size, fontSize }
    const [lastMoveRects, setLastMoveRects] = useState(null);
    const [kingResultBadges, setKingResultBadges] = useState(null);
    const [rightPanelOpen, setRightPanelOpen] = useState(() => {
        if (typeof window === 'undefined') return true;
        return window.innerWidth >= 1100;
    });

    // Mobile bottom sheet
    const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);
    const SHEET_MIN = 56; // px – collapsed (handle only)
    const [sheetHeight, setSheetHeight] = useState(SHEET_MIN);
    const sheetRef = useRef(null);
    const dragRef = useRef({ startY: 0, startH: SHEET_MIN, dragging: false });

    useEffect(() => {
        const mq = window.matchMedia('(max-width: 768px)');
        const handler = (e) => setIsMobile(e.matches);
        mq.addEventListener('change', handler);
        return () => mq.removeEventListener('change', handler);
    }, [profileKey]);

    // Persist active tab
    useEffect(() => {
        if (isMobile) {
            const saved = localStorage.getItem('dashboardSheetTab');
            if (saved && ['moves', 'analysis', 'ai'].includes(saved)) {
                setActiveTab(saved);
            }
        }
    }, [isMobile]);

    const saveTab = useCallback((tab) => {
        setActiveTab(tab);
        localStorage.setItem('dashboardSheetTab', tab);
    }, []);

    // Continuous drag handler — use state for handle node so effect re-runs when DOM mounts
    const [handleNode, setHandleNode] = useState(null);

    useEffect(() => {
        if (!handleNode || !isMobile) return;

        const getMaxH = () => window.innerHeight * 0.85;

        const onTouchStart = (e) => {
            const sheet = sheetRef.current;
            dragRef.current = {
                startY: e.touches[0].clientY,
                startH: sheet ? sheet.offsetHeight : SHEET_MIN,
                dragging: true,
            };
            if (sheet) sheet.style.transition = 'none';
        };

        const onTouchMove = (e) => {
            if (!dragRef.current.dragging) return;
            if (e.cancelable) e.preventDefault();
            const deltaY = dragRef.current.startY - e.touches[0].clientY;
            const newH = Math.min(getMaxH(), Math.max(SHEET_MIN, dragRef.current.startH + deltaY));
            setSheetHeight(newH);
        };

        const onTouchEnd = () => {
            if (!dragRef.current.dragging) return;
            dragRef.current.dragging = false;
            const sheet = sheetRef.current;
            if (sheet) sheet.style.transition = '';
        };

        handleNode.addEventListener('touchstart', onTouchStart, { passive: true });
        handleNode.addEventListener('touchmove', onTouchMove, { passive: false });
        handleNode.addEventListener('touchend', onTouchEnd, { passive: true });

        return () => {
            handleNode.removeEventListener('touchstart', onTouchStart);
            handleNode.removeEventListener('touchmove', onTouchMove);
            handleNode.removeEventListener('touchend', onTouchEnd);
        };
    }, [handleNode, isMobile]);

    const handleSheetTabClick = useCallback((tab) => {
        saveTab(tab);
        setSheetHeight((h) => {
            const halfH = window.innerHeight * 0.45;
            return h < halfH ? halfH : h;
        });
    }, [saveTab]);

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
        const record = await db.gameAnalysis.get(activeGame.id);
        return record?.analysisLog || null;
    }, [activeGame?.id]);

    const activePgn = useLiveQuery(async () => {
        if (!activeGame?.id) return activeGame?.pgn || '';
        const record = await db.gameContent.get(activeGame.id);
        return record?.pgn || activeGame?.pgn || '';
    }, [activeGame?.id, activeGame?.pgn]);

    useEffect(() => {
        if (!activeGame?.id) return;
        if (activePgn) return;
        let cancelled = false;

        const backfill = async () => {
            let pgn = '';
            if (typeof activeGame?.pgn === 'string' && activeGame.pgn.trim()) {
                pgn = activeGame.pgn.trim();
            }

            if (!pgn && (activeGame?.site || activeGame?.sourceUrl)) {
                const rawUrl = (activeGame.sourceUrl || activeGame.site || '').toString().trim();
                try {
                    const url = new URL(rawUrl);
                    if (url.hostname.includes('lichess.org')) {
                        const id = url.pathname.split('/').filter(Boolean).pop();
                        if (id) {
                            const res = await fetch(`https://lichess.org/game/export/${id}`);
                            if (res.ok) {
                                const text = await res.text();
                                if (text && text.trim()) pgn = text.trim();
                            }
                        }
                    }
                } catch {
                    // ignore
                }
            }

            if (!cancelled && pgn) {
                await saveGameContent({ gameId: activeGame.id, pgn, pgnHash: activeGame.pgnHash || '' });
            }
        };

        backfill();
        return () => {
            cancelled = true;
        };
    }, [activeGame?.id, activeGame?.site, activeGame?.sourceUrl, activeGame?.pgn, activeGame?.pgnHash, activePgn]);

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
        if (activeGame && activePgn) {
            // Only reset if it's a new game we haven't loaded yet
            if (loadedGameIdRef.current !== activeGame.id) {
                try {
                    const chess = new Chess();
                    chess.loadPgn(activePgn, { sloppy: true });

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
    }, [activeGame?.id, activePgn]);

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

    const getSafeName = (value) => {
        if (!value) return '?';
        if (typeof value === 'string') return value;
        return value.name || '?';
    };

    // Determine orientation: If hero is Black, flip board. Default to White.
    const boardOrientation = useMemo(() => {
        if (!activeGame || !activeProfiles.length) return 'white';
        const heroSide = getHeroSideFromGame(activeGame, activeProfiles);
        return heroSide === 'black' ? 'black' : 'white';
    }, [activeGame, activeProfiles]);

    const heroSideForGame = useMemo(() => {
        if (!activeGame || !activeProfiles.length) return null;
        return getHeroSideFromGame(activeGame, activeProfiles);
    }, [activeGame, activeProfiles]);

    useEffect(() => {
        // Scroll active move into view
        if (moveIndex >= 0) {
            const el = document.getElementById(`move-${moveIndex}`);
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }, [moveIndex]);

    const lastMove = useMemo(() => {
        if (!history || moveIndex < 0 || moveIndex >= history.length) return null;
        const move = history[moveIndex];
        if (!move?.from || !move?.to) return null;
        return { from: move.from, to: move.to, color: move.color };
    }, [history, moveIndex]);

    const flashPalette = useMemo(() => {
        const moveTone = lastMove?.color === 'b' ? 'black' : 'white';
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
    }, [lastMove?.color, flashColors]);

    useEffect(() => {
        if (!lastMove) return;
        setLastMoveFlash((v) => v + 1);
    }, [lastMove?.from, lastMove?.to, activeGame?.id]);

    useLayoutEffect(() => {
        if (!lastMove || previewFen) {
            setLastMoveRects(null);
            return;
        }
        const root = boardContainerRef.current;
        if (!root) return;
        const fromEl = root.querySelector(`[data-square="${lastMove.from}"]`);
        const toEl = root.querySelector(`[data-square="${lastMove.to}"]`);
        if (!fromEl || !toEl) return;

        const rootRect = root.getBoundingClientRect();
        const getRect = (el) => {
            const rect = el.getBoundingClientRect();
            return {
                left: Math.round(rect.left - rootRect.left),
                top: Math.round(rect.top - rootRect.top),
                size: Math.round(rect.width)
            };
        };
        setLastMoveRects({
            from: getRect(fromEl),
            to: getRect(toEl)
        });
    }, [lastMove?.from, lastMove?.to, boardWidth, boardOrientation, previewFen, lastMoveFlash]);

    const resultInfo = useMemo(() => {
        const result = activeGame?.result || '';
        if (!['1-0', '0-1', '1/2-1/2'].includes(result)) return null;
        if (previewFen) return null;
        if (!history?.length) return null;
        if (moveIndex < history.length - 1) return null;
        if (result === '1/2-1/2') {
            return { white: 'draw', black: 'draw' };
        }
        if (result === '1-0') {
            return { white: 'win', black: 'lose' };
        }
        return { white: 'lose', black: 'win' };
    }, [activeGame?.result, previewFen, history?.length, moveIndex]);

    useLayoutEffect(() => {
        if (!resultInfo || !currentFen) {
            setKingResultBadges(null);
            return;
        }
        const root = boardContainerRef.current;
        if (!root) return;
        try {
            const chess = new Chess(currentFen);
            const board = chess.board();
            let whiteSquare = null;
            let blackSquare = null;
            for (let rank = 0; rank < 8; rank++) {
                for (let file = 0; file < 8; file++) {
                    const piece = board[rank][file];
                    if (!piece || piece.type !== 'k') continue;
                    const fileChar = String.fromCharCode(97 + file);
                    const rankNum = 8 - rank;
                    const square = `${fileChar}${rankNum}`;
                    if (piece.color === 'w') whiteSquare = square;
                    else blackSquare = square;
                }
            }
            if (!whiteSquare || !blackSquare) {
                setKingResultBadges(null);
                return;
            }

            const rootRect = root.getBoundingClientRect();
            const getPos = (square) => {
                const el = root.querySelector(`[data-square="${square}"]`);
                if (!el) return null;
                const rect = el.getBoundingClientRect();
                return {
                    left: Math.round(rect.left - rootRect.left + rect.width - 20),
                    top: Math.round(rect.top - rootRect.top + 4)
                };
            };

            const whitePos = getPos(whiteSquare);
            const blackPos = getPos(blackSquare);
            if (!whitePos || !blackPos) {
                setKingResultBadges(null);
                return;
            }

            setKingResultBadges({
                white: { ...whitePos, status: resultInfo.white },
                black: { ...blackPos, status: resultInfo.black }
            });
        } catch (err) {
            console.warn('Failed to compute king result badges', err);
            setKingResultBadges(null);
        }
    }, [resultInfo, currentFen, boardWidth, boardOrientation]);

    const getMeta = (key) => {
        if (!activeGame) return '?';
        if (activeGame[key]) return getSafeName(activeGame[key]);
        const match = activePgn && activePgn.match(new RegExp(`\\[${key} "(.+?)"\\]`));
        return match ? match[1] : '?';
    };

    const getTitleTag = (tag) => {
        if (!activePgn) return '';
        const match = activePgn.match(new RegExp(`\\[${tag} "([^"]*)"\\]`));
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
        const flashVariant = lastMoveFlash % 2 === 0 ? 'a' : 'b';
        const showLastMove = !previewFen && lastMove;
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
            id: "dashboard-board",
            position: previewFen || currentFen,
            boardWidth: boardWidth || 500,
            boardOrientation: boardOrientation,
            allowDragging: false,
            animationDurationInMs: 300,
            arrows: arrow ? [{ startSquare: arrow.from, endSquare: arrow.to, color: 'rgba(245, 200, 75, 0.95)' }] : [],
            darkSquareStyle: { backgroundColor: boardColors.dark },
            lightSquareStyle: { backgroundColor: boardColors.light },
            squareStyles: showLastMove ? {
                [lastMove.from]: { ...fromStyle, ...flashFrom },
                [lastMove.to]: { ...toStyle, ...flashTo }
            } : {}
        };
    }, [currentFen, previewFen, boardWidth, boardOrientation, hoverArrow, defaultArrow, lastMove, lastMoveFlash, boardColors, flashPalette]);

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
                const size = Math.max(16, Math.min(22, Math.round(rect.width * 0.32)));
                const inset = Math.max(1, Math.round(size * 0.12));
                const fontSize = Math.max(9, Math.round(size * 0.5));
                setBadgeStyle({
                    left: Math.round(rect.left - rootRect.left + rect.width - size - inset),
                    top: Math.round(rect.top - rootRect.top + inset),
                    size,
                    fontSize
                });
                return;
            }
        }

        // Fallback: math-based placement (square top-right)
        const file = square.charCodeAt(0) - 97;
        const rank = parseInt(square[1], 10) - 1;
        const size = (boardWidth || 500) / 8;
        const badgeSize = Math.max(16, Math.min(22, Math.round(size * 0.32)));
        const inset = Math.max(1, Math.round(badgeSize * 0.12));
        const fontSize = Math.max(9, Math.round(badgeSize * 0.5));

        let x = file;
        let y = 7 - rank;
        if (boardOrientation === 'black') {
            x = 7 - file;
            y = rank;
        }
        setBadgeStyle({
            left: Math.round(x * size + size - badgeSize - inset),
            top: Math.round(y * size + inset),
            size: badgeSize,
            fontSize
        });
    }, [classificationBadge, history, moveIndex, boardWidth, boardOrientation, previewFen]);

    // Close menu only via toggle or selection (avoid click-outside issues on small screens).

    if (!stats) return <div className="p-8 text-secondary">Loading dashboard...</div>;

    const hasGames = (totalGames ?? 0) > 0;
    const showContextPanel = hasGames && !!activeGame;

    return (
        <div className={`dashboard-shell bg-app ${rightPanelOpen ? '' : 'dashboard-shell--collapsed'}`}>

            {/* LEFT / CENTER: Chessboard Area */}
            <div className="dashboard-center flex flex-col min-w-0 relative">
                {/* Added w-full to ensure this container takes width */}
                {/* Main Board Area */}
                <div className={`dashboard-board-area flex-1 flex flex-col items-center justify-start min-h-0 w-full p-4 ${!activeGame ? 'is-empty' : ''}`}>

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
                                {!isMobile && (
                                    <button
                                        onClick={() => setRightPanelOpen((v) => !v)}
                                        className="panel-toggle"
                                    >
                                        {rightPanelOpen ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
                                        {rightPanelOpen ? 'Hide Panel' : 'Show Panel'}
                                    </button>
                                )}
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
                                    {lastMoveRects && !previewFen && (
                                        <>
                                            <div
                                                key={`last-move-from-${lastMoveFlash}`}
                                                className="last-move-flash last-move-flash--from"
                                                style={{
                                                    left: lastMoveRects.from.left,
                                                    top: lastMoveRects.from.top,
                                                    width: lastMoveRects.from.size,
                                                    height: lastMoveRects.from.size,
                                                    background: `radial-gradient(circle at 50% 50%, ${flashPalette.fromFill}, rgba(0, 0, 0, 0) 70%)`,
                                                    boxShadow: `0 0 18px ${flashPalette.fromRing}`
                                                }}
                                            />
                                            <div
                                                key={`last-move-to-${lastMoveFlash}`}
                                                className="last-move-flash last-move-flash--to"
                                                style={{
                                                    left: lastMoveRects.to.left,
                                                    top: lastMoveRects.to.top,
                                                    width: lastMoveRects.to.size,
                                                    height: lastMoveRects.to.size,
                                                    background: `radial-gradient(circle at 50% 50%, ${flashPalette.toFill}, rgba(0, 0, 0, 0) 70%)`,
                                                    boxShadow: `0 0 24px ${flashPalette.toRing}`
                                                }}
                                            />
                                        </>
                                    )}
                                    {badgeStyle && classificationBadge && (
                                        <div
                                            className={`board-badge badge-${classificationBadge.tone}`}
                                            style={{
                                                left: badgeStyle.left,
                                                top: badgeStyle.top,
                                                width: badgeStyle.size,
                                                height: badgeStyle.size,
                                                fontSize: badgeStyle.fontSize
                                            }}
                                        >
                                            {classificationBadge.label}
                                        </div>
                                    )}
                                    {kingResultBadges && (
                                        <>
                                            <div
                                                className={`king-result-badge king-result-badge--${kingResultBadges.white.status}`}
                                                style={{ left: kingResultBadges.white.left, top: kingResultBadges.white.top }}
                                            >
                                                {kingResultBadges.white.status === 'win' ? 'WIN' : kingResultBadges.white.status === 'lose' ? 'LOSE' : 'DRAW'}
                                            </div>
                                            <div
                                                className={`king-result-badge king-result-badge--${kingResultBadges.black.status}`}
                                                style={{ left: kingResultBadges.black.left, top: kingResultBadges.black.top }}
                                            >
                                                {kingResultBadges.black.status === 'win' ? 'WIN' : kingResultBadges.black.status === 'lose' ? 'LOSE' : 'DRAW'}
                                            </div>
                                        </>
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
                        <div className="dashboard-empty">
                            <div className="dashboard-empty__card">
                                <Activity size={56} className="text-muted mb-4" />
                                <h3 className="text-xl font-semibold text-primary mb-2">
                                    {hasGames ? 'No game selected' : 'No games yet'}
                                </h3>
                                <p className="text-secondary text-center mb-6 max-w-sm">
                                    {hasGames
                                        ? 'Pick a game from your library or import a PGN to start analyzing.'
                                        : 'Import a game PGN to start analyzing your moves and unlock insights.'}
                                </p>
                                <div className="flex items-center gap-3">
                                    <Link to="/import" className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-full font-medium transition-colors">
                                        Import Game
                                    </Link>
                                    <Link to="/library" className="px-6 py-2 bg-subtle hover:bg-subtle text-primary rounded-full font-medium transition-colors border border-white/10">
                                        View Library
                                    </Link>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Controls */}
                    {activeGame && (
                        <div className="board-wrap flex items-center justify-center gap-4 w-full py-4 shrink-0">
                            <button onClick={handleStart} className="p-2 hover:bg-subtle rounded-full text-secondary transition-colors" title="Start"><Rewind size={20} fill="currentColor" /></button>
                            <button onClick={handlePrev} className="p-3 hover:bg-subtle rounded-full text-primary transition-colors bg-subtle border" title="Previous"><ChevronLeft size={24} /></button>
                            <button onClick={handleNext} className="p-3 hover:bg-subtle rounded-full text-primary transition-colors bg-subtle border" title="Next"><ChevronRight size={24} /></button>
                            <button onClick={handleEnd} className="p-2 hover:bg-subtle rounded-full text-secondary transition-colors" title="End"><FastForward size={20} fill="currentColor" /></button>
                        </div>
                    )}

                    {!isMobile && !rightPanelOpen && showContextPanel && (
                        <button className="panel-toggle panel-toggle--floating" onClick={() => setRightPanelOpen(true)}>
                            <ChevronLeft size={16} />
                            Show Panel
                        </button>
                    )}

                    {showAIModal && activeGame && (
                        <div className="absolute inset-0 flex items-center justify-center p-4" style={{ zIndex: 9999 }}>
                            <AIAnalysisModal
                                game={activeGame}
                                pgn={activePgn}
                                analysisLog={analysisLog}
                                heroSide={heroSideForGame}
                                heroName={heroDisplayName}
                                onClose={() => setShowAIModal(false)}
                                onAnalysisComplete={() => {
                                    setActiveTab('ai');
                                }}
                            />
                        </div>
                    )}
                </div>
            </div>



            {/* RIGHT: Context Panel — Desktop: side panel, Mobile: bottom sheet */}
            {showContextPanel ? (
                isMobile ? (
                <div
                    ref={sheetRef}
                    className="dashboard-bottom-sheet"
                    style={{ height: `${sheetHeight}px` }}
                >
                    {/* Drag Handle */}
                    <div
                        ref={setHandleNode}
                        className="bottom-sheet__handle"
                    >
                        <div className="bottom-sheet__grip"><GripHorizontal size={20} /></div>
                        <div className="bottom-sheet__tabs">
                            <button
                                onClick={() => handleSheetTabClick('moves')}
                                className={`bottom-sheet__tab ${activeTab === 'moves' ? 'is-active' : ''}`}
                            >Moves</button>
                            <button
                                onClick={() => handleSheetTabClick('analysis')}
                                className={`bottom-sheet__tab ${activeTab === 'analysis' ? 'is-active' : ''}`}
                            >Analytics</button>
                            <button
                                onClick={() => handleSheetTabClick('ai')}
                                className={`bottom-sheet__tab ${activeTab === 'ai' ? 'is-active' : ''}`}
                            >
                                <span className={aiAnalysis ? 'text-purple-400' : ''}>AI</span>
                            </button>
                        </div>
                    </div>

                    {/* Scrollable Content */}
                    <div className="bottom-sheet__content">
                        {activeTab === 'ai' ? (
                            aiAnalysis ? (
                                <AIInsightsView
                                    analysis={aiAnalysis}
                                    onJumpToMove={(moveIdx) => handleJumpTo(moveIdx)}
                                />
                            ) : (
                                <div className="bottom-sheet__empty">
                                    <span className="text-purple-400" style={{ fontSize: 28 }}>✦</span>
                                    <p className="font-medium text-primary">AI Coach</p>
                                    <p className="text-muted text-xs">Tap the AI analysis button above the board to get personalized insights, blunder explanations, and improvement tips for this game.</p>
                                </div>
                            )
                        ) : activeTab === 'analysis' ? (
                            (analysisLog && analysisLog.length > 0) ? (
                                <AnalyticsPanel
                                    game={{ ...activeGame, analysisLog }}
                                    onJumpToMove={handleJumpTo}
                                    activeIndex={moveIndex}
                                    onBestHover={(uci) => {
                                        if (!uci || typeof uci !== 'string' || uci.length < 4) { setHoverArrow(null); return; }
                                        setHoverArrow({ from: uci.substring(0, 2), to: uci.substring(2, 4) });
                                    }}
                                    onPreviewFen={(fen) => setPreviewFen(fen)}
                                />
                            ) : (
                                <div className="bottom-sheet__empty">
                                    <span style={{ fontSize: 28 }}>📊</span>
                                    <p className="font-medium text-primary">Move Analytics</p>
                                    <p className="text-muted text-xs">Run the engine analysis using the button above the board to see accuracy scores, blunder detection, and move-by-move evaluation.</p>
                                </div>
                            )
                        ) : (
                            <>
                                <div className="move-list text-sm">
                                    <div className="move-row move-header">
                                        <div className="move-num text-muted">#</div>
                                        <div className="move-cell move-cell-white text-muted">White</div>
                                        <div className="move-cell move-cell-black text-muted">Black</div>
                                    </div>
                                    {history.reduce((rows, move, i) => {
                                        if (i % 2 === 0) rows.push([move]);
                                        else rows[rows.length - 1].push(move);
                                        return rows;
                                    }, []).map((pair, rowIdx) => {
                                        const wm = pair[0], bm = pair[1];
                                        const wi = rowIdx * 2, bi = rowIdx * 2 + 1;
                                        return (
                                            <div key={rowIdx} className={`move-row ${rowIdx % 2 === 0 ? 'move-row-even' : 'move-row-odd'}`}>
                                                <div className="move-num text-muted">{rowIdx + 1}</div>
                                                <button id={`move-${wi}`} onClick={() => handleJumpTo(wi)} className={`move-cell move-cell-white ${moveIndex === wi ? 'move-cell-active' : ''}`}>{wm?.san || '-'}</button>
                                                <button id={`move-${bi}`} onClick={() => handleJumpTo(bi)} disabled={!bm} className={`move-cell move-cell-black ${moveIndex === bi ? 'move-cell-active' : ''}`}>{bm?.san || '-'}</button>
                                            </div>
                                        );
                                    })}
                                </div>
                                {activeTab === 'moves' && moveInsight && (
                                    <div className="p-4 border-t flex flex-col gap-2">
                                        <h3 className="text-xs font-semibold text-muted uppercase tracking-wider">Move Insights</h3>
                                        <StatRow label="Classification" value={moveInsight.classification || '-'} subtext="Move quality" icon={Target} color="blue" />
                                        <StatRow label="Eval Swing" value={typeof moveInsight.evalDiff === 'number' ? `${Math.round(moveInsight.evalDiff)}cp` : '-'} subtext="Centipawn loss" icon={Activity} color="orange" />
                                        <StatRow label="Best Move" value={uciToSan(moveInsight.fen, moveInsight.bestMove) || '-'} subtext="Engine recommendation" icon={Zap} color="yellow" />
                                        <StatRow label="Your Move" value={uciToSan(moveInsight.fen, moveInsight.move) || '-'} subtext="Played move" icon={ArrowUpRight} color="green" />
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>
                ) : (
                <div className="dashboard-side bg-panel border-l flex flex-col shrink-0 overflow-hidden">
                    <div className="flex-1 flex flex-col min-h-0 relative">
                        <div className="flex items-center border-b bg-subtle/50 shrink-0">
                            <button
                                onClick={() => setActiveTab('moves')}
                                className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider transition-colors ${activeTab === 'moves' ? 'text-primary bg-panel border-b-2 border-primary' : 'text-muted hover:text-secondary'}`}
                            >Moves</button>
                            <button
                                onClick={() => setActiveTab('analysis')}
                                className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider transition-colors ${activeTab === 'analysis' ? 'text-primary bg-panel border-b-2 border-primary' : 'text-muted hover:text-secondary'}`}
                            >Analytics</button>
                            <button
                                onClick={() => setActiveTab('ai')}
                                className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider transition-colors ${activeTab === 'ai' ? 'text-primary bg-panel border-b-2 border-primary' : 'text-muted hover:text-secondary'}`}
                            >
                                <span className={aiAnalysis ? 'text-purple-400' : ''}>AI Coach</span>
                            </button>
                        </div>
                        <div className="flex-1 overflow-y-auto min-h-0 bg-panel relative">
                            {activeTab === 'ai' ? (
                                aiAnalysis ? (
                                    <AIInsightsView analysis={aiAnalysis} onJumpToMove={(moveIdx) => handleJumpTo(moveIdx)} />
                                ) : (
                                    <div className="p-8 text-center text-muted">
                                        <div className="text-purple-400" style={{ fontSize: 28 }}>✦</div>
                                        <div className="text-primary font-medium mt-2">AI Coach</div>
                                        <div className="text-muted text-xs mt-1">
                                            Tap the AI analysis button above the board to get personalized insights, blunder explanations, and improvement tips for this game.
                                        </div>
                                    </div>
                                )
                            ) : activeTab === 'analysis' ? (
                                (analysisLog && analysisLog.length > 0) ? (
                                    <AnalyticsPanel
                                        game={{ ...activeGame, analysisLog }}
                                        onJumpToMove={handleJumpTo}
                                        activeIndex={moveIndex}
                                        onBestHover={(uci) => {
                                            if (!uci || typeof uci !== 'string' || uci.length < 4) { setHoverArrow(null); return; }
                                            setHoverArrow({ from: uci.substring(0, 2), to: uci.substring(2, 4) });
                                        }}
                                        onPreviewFen={(fen) => setPreviewFen(fen)}
                                    />
                                ) : (
                                    <div className="p-8 text-center text-muted">Analysis not available yet. Run analysis to unlock move quality and evaluation insights.</div>
                                )
                            ) : (
                                <div className="move-list text-sm">
                                    <div className="move-row move-header">
                                        <div className="move-num text-muted">#</div>
                                        <div className="move-cell move-cell-white text-muted">White</div>
                                        <div className="move-cell move-cell-black text-muted">Black</div>
                                    </div>
                                    {history.reduce((rows, move, i) => {
                                        if (i % 2 === 0) rows.push([move]);
                                        else rows[rows.length - 1].push(move);
                                        return rows;
                                    }, []).map((pair, rowIdx) => {
                                        const wm = pair[0], bm = pair[1];
                                        const wi = rowIdx * 2, bi = rowIdx * 2 + 1;
                                        return (
                                            <div key={rowIdx} className={`move-row ${rowIdx % 2 === 0 ? 'move-row-even' : 'move-row-odd'}`}>
                                                <div className="move-num text-muted">{rowIdx + 1}</div>
                                                <button id={`move-${wi}`} onClick={() => handleJumpTo(wi)} className={`move-cell move-cell-white ${moveIndex === wi ? 'move-cell-active' : ''}`}>{wm?.san || '-'}</button>
                                                <button id={`move-${bi}`} onClick={() => handleJumpTo(bi)} disabled={!bm} className={`move-cell move-cell-black ${moveIndex === bi ? 'move-cell-active' : ''}`}>{bm?.san || '-'}</button>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
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
                )
            ) : null}
        </div>
    );
};
