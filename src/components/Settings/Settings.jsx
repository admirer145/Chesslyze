import React, { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../services/db';
import { engine } from '../../services/engine';
import { AlertCircle, CheckCircle } from 'lucide-react';
import { Chess } from 'chess.js';

export const Settings = () => {
    const heroUser = (localStorage.getItem('heroUser') || '').toLowerCase();
    const [status, setStatus] = useState(null);
    const [depth, setDepth] = useState(() => parseInt(localStorage.getItem('engineDepth') || '15', 10));
    const [multiPv, setMultiPv] = useState(() => {
        const v = parseInt(localStorage.getItem('engineMultiPv') || '3', 10);
        return Number.isNaN(v) ? 3 : v;
    });
    const [preset, setPreset] = useState(() => localStorage.getItem('enginePreset') || 'custom');
    const [bookStatus, setBookStatus] = useState(null);
    const [engineInfo, setEngineInfo] = useState(() => engine.getInfo());
    const [deepDepth, setDeepDepth] = useState(() => {
        const v = parseInt(localStorage.getItem('engineDeepDepth') || '0', 10);
        return Number.isNaN(v) ? 0 : v;
    });

    const games = useLiveQuery(async () => {
        return await db.games.toArray();
    }, []);

    useEffect(() => {
        // Ensure worker initialized so we can read id name / caps.
        engine.init().then(() => setEngineInfo(engine.getInfo())).catch(() => { });
        const t = setTimeout(() => setEngineInfo(engine.getInfo()), 400);

        // Auto-migrate idle to pending per user request - REMOVED to allow distinction
        // db.games.where('analysisStatus').equals('idle').modify({ analysisStatus: 'pending' }).catch(() => {});

        return () => clearTimeout(t);
    }, []);

    const stats = useMemo(() => {
        if (!games) return { total: 0, heroTotal: 0, analyzed: 0, pending: 0, ignored: 0 };
        let heroTotal = 0;
        let analyzed = 0;
        let pending = 0;
        let ignored = 0;
        let analyzing = 0;
        let failed = 0;
        games.forEach((g) => {
            const isHero = heroUser && (g.white?.toLowerCase() === heroUser || g.black?.toLowerCase() === heroUser);
            if (isHero) heroTotal += 1;

            if (g.analysisStatus === 'analyzing') {
                analyzing += 1;
            } else if (g.analysisStatus === 'failed') {
                failed += 1;
            } else if (g.analysisStatus === 'ignored') {
                ignored += 1;
            } else if (g.analysisStatus === 'completed' || (g.analyzed && g.analysisStatus !== 'failed')) {
                // Completed or Legacy Analyzed (excluding failed)
                analyzed += 1;
            } else if (g.analysisStatus === 'pending') {
                // Explicitly pending
                pending += 1;
            } else {
                // No status = Idle
                // We track this as part of "pending" in the summary object if we want generic "unanalyzed", 
                // but let's separate them if we want to show distinct stats.
                // For now, let's keep the return object simple or add 'idle'.
                // The user wants to differentiate.
            }
        });

        // Recalculate generic "idle" as total - (analyzed + pending + analyzing + failed + ignored)
        // Or just count them explicitly:
        const idle = games.length - (analyzed + pending + analyzing + failed + ignored);

        return { total: games.length, heroTotal, analyzed, pending, ignored, analyzing, failed, idle };
    }, [games, heroUser]);

    const handleAnalyzeAll = async () => {
        if (!games) return;
        setStatus({ type: 'loading', message: 'Queueing analysis for unanalyzed games...' });
        try {
            // Only target games that are NOT analyzed OR have failed
            const targetGames = await db.games
                .filter((g) => {
                    const isHero = heroUser && (g.white?.toLowerCase() === heroUser || g.black?.toLowerCase() === heroUser);
                    const needsAnalysis = !g.analyzed || g.analysisStatus === 'failed';
                    return isHero && needsAnalysis;
                })
                .modify({
                    analysisStatus: 'pending',
                    priority: 1 // Low priority for bulk analysis
                });

            setStatus({ type: 'success', message: `Queued ${targetGames} games for analysis.` });
        } catch (err) {
            console.error(err);
            setStatus({ type: 'error', message: 'Failed to queue analysis.' });
        }
    };

    const handleStopAnalysis = async () => {
        setStatus({ type: 'loading', message: 'Stopping analysis and clearing queue...' });
        try {
            engine.stop();
            engine.terminate();
            // We do NOT reset pending games to idle anymore, they remain pending to be picked up next time.
            await db.games.where('analysisStatus').equals('analyzing').modify({ analysisStatus: 'pending', analysisStartedAt: null, analysisHeartbeatAt: null });
            setStatus({ type: 'success', message: 'Analysis stopped. Analyzing games reset to pending.' });
        } catch (err) {
            console.error(err);
            setStatus({ type: 'error', message: 'Failed to stop analysis.' });
        }
    };

    const fetchMasterGames = async (fen) => {
        const url = `https://explorer.lichess.ovh/masters?fen=${encodeURIComponent(fen)}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error('Failed to fetch master games');
        return await res.json();
    };

    const fenKey = (fen) => {
        if (!fen || typeof fen !== 'string') return '';
        return fen.split(' ').slice(0, 4).join(' ');
    };

    const syncBookMoves = async () => {
        if (!games) return;
        setBookStatus({ type: 'loading', message: 'Starting sync...' });
        try {
            const openings = {};
            games.forEach((game) => {
                if (!game.eco) return;
                if (!openings[game.eco]) {
                    openings[game.eco] = {
                        eco: game.eco,
                        name: game.openingName || 'Unknown Opening',
                        sampleGameId: game.id
                    };
                }
            });

            const ecoList = Object.values(openings);
            for (let i = 0; i < ecoList.length; i++) {
                const opening = ecoList[i];
                setBookStatus({ type: 'loading', message: `Syncing ${opening.eco} (${i + 1}/${ecoList.length})...` });

                // 1. Load existing cache
                const cachedEntry = await db.openings.get(opening.eco);
                const masterMoveByFen = cachedEntry?.masterMoveByFen || {};
                const masterMovesAll = new Set(cachedEntry?.masterMoves || []);

                const game = await db.games.get(opening.sampleGameId);
                if (!game?.pgn) continue;

                const base = new Chess();
                base.loadPgn(game.pgn);
                const header = base.header();
                const initFen = header['FEN'] || 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
                const moves = base.history({ verbose: true });

                const walk = new Chess(initFen);
                const seenKeys = new Set();
                let didFetch = false;

                // Fetch book moves for early positions
                const plyTarget = Math.min(14, moves.length);
                for (let j = 0; j <= plyTarget; j++) {
                    const fen = walk.fen();
                    const key = fenKey(fen);

                    if (key && !seenKeys.has(key)) {
                        // Check if we already have this position cached
                        if (!masterMoveByFen[key]) {
                            try {
                                const data = await fetchMasterGames(fen);
                                const masterMoves = (data.moves || [])
                                    .map((m) => (typeof m === 'string' ? m : m.uci))
                                    .filter(Boolean);
                                masterMoveByFen[key] = masterMoves;
                                didFetch = true;
                                await new Promise((r) => setTimeout(r, 1200)); // Rate limit 1.2s
                            } catch (e) {
                                console.warn(`Failed to fetch for ${opening.eco} position ${j}`, e);
                            }
                        }

                        // Add found moves to the set
                        if (masterMoveByFen[key]) {
                            masterMoveByFen[key].forEach((m) => masterMovesAll.add(m));
                        }
                        seenKeys.add(key);
                    }

                    const nextMove = moves[j];
                    if (!nextMove) break;
                    walk.move({ from: nextMove.from, to: nextMove.to, promotion: nextMove.promotion });
                }

                if (didFetch || !cachedEntry) {
                    await db.openings.put({
                        ...cachedEntry,
                        eco: opening.eco,
                        name: opening.name,
                        masterMoves: Array.from(masterMovesAll),
                        masterMoveByFen,
                        updatedAt: new Date().toISOString()
                    });
                }
            }

            setBookStatus({ type: 'success', message: 'Book moves synced for all openings.' });
        } catch (err) {
            console.error(err);
            setBookStatus({ type: 'error', message: 'Failed to sync book moves.' });
        }
    };

    const handleDepthChange = (value) => {
        setDepth(value);
        localStorage.setItem('engineDepth', String(value));
        setPreset('custom');
        localStorage.setItem('enginePreset', 'custom');
    };

    const handleMultiPvChange = (value) => {
        setMultiPv(value);
        localStorage.setItem('engineMultiPv', String(value));
        setPreset('custom');
        localStorage.setItem('enginePreset', 'custom');
    };

    const handleDeepDepthChange = (value) => {
        setDeepDepth(value);
        localStorage.setItem('engineDeepDepth', String(value));
    };

    const handlePresetChange = (value) => {
        setPreset(value);
        localStorage.setItem('enginePreset', value);
        const presets = {
            fast: { depth: 10, multiPv: 1 },
            balanced: { depth: 14, multiPv: 2 },
            deep: { depth: 20, multiPv: 3 }
        };
        const next = presets[value];
        if (!next) return;
        setDepth(next.depth);
        setMultiPv(next.multiPv);
        localStorage.setItem('engineDepth', String(next.depth));
        localStorage.setItem('engineMultiPv', String(next.multiPv));
    };

    return (
        <div className="h-full w-full bg-app p-8 overflow-y-auto">
            <div className="flex flex-col gap-6" style={{ maxWidth: 900, margin: '0 auto' }}>
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="text-2xl font-semibold text-primary">Settings</h2>
                        <p className="text-secondary">Manage analysis runs and local data.</p>
                    </div>
                    <div className="text-xs text-muted">Hero: {heroUser || 'Not set'}</div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="p-4 rounded-lg border bg-panel text-center">
                        <div className="text-xs text-muted uppercase tracking-wider mb-1">Total Games</div>
                        <div className="text-2xl font-bold text-primary">{stats.total}</div>
                    </div>
                    <div className="p-4 rounded-lg border bg-panel text-center">
                        <div className="text-xs text-muted uppercase tracking-wider mb-1">Hero Games</div>
                        <div className="text-2xl font-bold text-primary">{stats.heroTotal}</div>
                    </div>
                    <div className="p-4 rounded-lg border bg-panel text-center">
                        <div className="text-xs text-muted uppercase tracking-wider mb-1">Analyzed</div>
                        <div className="text-2xl font-bold text-green-400">{stats.analyzed}</div>
                    </div>
                    <div className="p-4 rounded-lg border bg-panel text-center">
                        <div className="text-xs text-muted uppercase tracking-wider mb-1">Pending</div>
                        <div className="text-2xl font-bold text-orange-400">{stats.pending}</div>
                    </div>
                    <div className="p-4 rounded-lg border bg-panel text-center">
                        <div className="text-xs text-muted uppercase tracking-wider mb-1">Idle</div>
                        <div className="text-2xl font-bold text-secondary">{stats.idle}</div>
                    </div>
                    <div className="p-4 rounded-lg border bg-panel text-center">
                        <div className="text-xs text-muted uppercase tracking-wider mb-1">Analyzing</div>
                        <div className="text-2xl font-bold text-blue-400">{stats.analyzing}</div>
                    </div>
                    <div className="p-4 rounded-lg border bg-panel text-center">
                        <div className="text-xs text-muted uppercase tracking-wider mb-1">Failed</div>
                        <div className="text-2xl font-bold text-rose-400">{stats.failed}</div>
                    </div>
                </div>

                <div className="p-6 rounded-lg border bg-panel">
                    <h3 className="text-sm font-semibold text-primary mb-3">Analyze All Games</h3>
                    <p className="text-sm text-secondary mb-4">
                        Queue analysis for all games that haven't been analyzed yet. Already analyzed games will be skipped.
                    </p>
                    <button className="btn btn-primary" onClick={handleAnalyzeAll}>
                        Analyze All (Unanalyzed)
                    </button>

                    {status && (
                        <div className="mt-4 flex items-center gap-2 text-sm">
                            {status.type === 'success' && <CheckCircle size={16} className="text-green-400" />}
                            {status.type === 'error' && <AlertCircle size={16} className="text-red-400" />}
                            <span className="text-secondary">{status.message}</span>
                        </div>
                    )}
                </div>

                <div className="p-6 rounded-lg border bg-panel">
                    <h3 className="text-sm font-semibold text-primary mb-3">Stop Analysis</h3>
                    <p className="text-sm text-secondary mb-4">
                        Halts the engine and clears any queued games. Already running analysis may finish its current move.
                    </p>
                    <button className="btn btn-secondary" onClick={handleStopAnalysis}>
                        Stop Analysis
                    </button>
                </div>

                <div className="p-6 rounded-lg border bg-panel">
                    <h3 className="text-sm font-semibold text-primary mb-3">Engine Profile</h3>
                    <p className="text-sm text-secondary mb-4">
                        This app currently runs a single Stockfish build locally, but you can switch between analysis profiles
                        (depth + top lines) depending on speed vs accuracy.
                    </p>
                    <div className="text-xs text-muted mb-4">
                        Engine: {engineInfo?.name || 'Unknown'} • NNUE: {engineInfo?.caps?.nnue ? 'Yes' : 'No'} • MultiPV: {engineInfo?.caps?.multipv ? 'Yes' : 'No'}
                    </div>
                    <div className="flex items-center gap-3">
                        <select
                            value={preset}
                            onChange={(e) => handlePresetChange(e.target.value)}
                            className="bg-subtle border rounded px-3 py-2 text-sm text-primary"
                        >
                            <option value="fast">Fast</option>
                            <option value="balanced">Balanced</option>
                            <option value="deep">Deep</option>
                            <option value="custom">Custom</option>
                        </select>
                        <div className="text-xs text-muted">Applies to new analysis runs.</div>
                    </div>
                </div>

                <div className="p-6 rounded-lg border bg-panel">
                    <h3 className="text-sm font-semibold text-primary mb-3">Engine Depth</h3>
                    <p className="text-sm text-secondary mb-4">
                        Higher depth improves accuracy but is slower. Depth 50+ is expensive in WASM; consider using MultiPV first.
                    </p>
                    <div className="flex items-center gap-4">
                        <input
                            type="range"
                            min="8"
                            max="60"
                            value={depth}
                            onChange={(e) => handleDepthChange(parseInt(e.target.value, 10))}
                        />
                        <div className="text-sm text-primary">Depth {depth}</div>
                    </div>
                </div>

                <div className="p-6 rounded-lg border bg-panel">
                    <h3 className="text-sm font-semibold text-primary mb-3">Top Lines (MultiPV)</h3>
                    <p className="text-sm text-secondary mb-4">
                        Show more than one best line. This also helps avoid false "opening mistakes" by considering multiple strong candidates.
                    </p>
                    <div className="flex items-center gap-4">
                        <input
                            type="range"
                            min="1"
                            max="5"
                            value={multiPv}
                            onChange={(e) => handleMultiPvChange(parseInt(e.target.value, 10))}
                        />
                        <div className="text-sm text-primary">{multiPv} line{multiPv === 1 ? '' : 's'}</div>
                    </div>
                </div>

                <div className="p-6 rounded-lg border bg-panel">
                    <h3 className="text-sm font-semibold text-primary mb-3">Deep Verification Depth</h3>
                    <p className="text-sm text-secondary mb-4">
                        Optional second-pass depth used only to re-check moves the engine flags as blunders.
                        This reduces false positives without analyzing every move at depth 50+.
                    </p>
                    <div className="flex items-center gap-4">
                        <input
                            type="range"
                            min="0"
                            max="60"
                            value={deepDepth}
                            onChange={(e) => handleDeepDepthChange(parseInt(e.target.value, 10))}
                        />
                        <div className="text-sm text-primary">{deepDepth === 0 ? 'Off' : `Depth ${deepDepth}`}</div>
                    </div>
                </div>

                <div className="p-6 rounded-lg border bg-panel">
                    <h3 className="text-sm font-semibold text-primary mb-3">Book Moves (Master Database)</h3>
                    <p className="text-sm text-secondary mb-4">
                        Sync master book moves for all your openings to enrich analytics and book move detection.
                    </p>
                    <button className="btn btn-secondary" onClick={syncBookMoves}>
                        Sync Book Moves
                    </button>
                    {bookStatus && (
                        <div className="mt-4 flex items-center gap-2 text-sm">
                            {bookStatus.type === 'success' && <CheckCircle size={16} className="text-green-400" />}
                            {bookStatus.type === 'error' && <AlertCircle size={16} className="text-red-400" />}
                            <span className="text-secondary">{bookStatus.message}</span>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
