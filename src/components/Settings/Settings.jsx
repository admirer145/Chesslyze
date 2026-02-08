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
        return () => clearTimeout(t);
    }, []);

    const stats = useMemo(() => {
        if (!games) return { total: 0, heroTotal: 0, analyzed: 0, pending: 0, ignored: 0 };
        let heroTotal = 0;
        let analyzed = 0;
        let pending = 0;
        let ignored = 0;
        games.forEach((g) => {
            const isHero = heroUser && (g.white?.toLowerCase() === heroUser || g.black?.toLowerCase() === heroUser);
            if (isHero) heroTotal += 1;
            if (g.analysisStatus === 'pending') pending += 1;
            if (g.analysisStatus === 'ignored') ignored += 1;
            if (g.analyzed) analyzed += 1;
        });
        return { total: games.length, heroTotal, analyzed, pending, ignored };
    }, [games, heroUser]);

    const handleReanalyzeAll = async () => {
        if (!games) return;
        setStatus({ type: 'loading', message: 'Queueing re-analysis for your games...' });
        try {
            await db.games
                .filter((g) => heroUser && (g.white?.toLowerCase() === heroUser || g.black?.toLowerCase() === heroUser))
                .modify({
                    analyzed: false,
                    analysisStatus: 'pending',
                    analyzedAt: null
                });
            setStatus({ type: 'success', message: 'Re-analysis queued. This may take a while.' });
        } catch (err) {
            console.error(err);
            setStatus({ type: 'error', message: 'Failed to queue re-analysis.' });
        }
    };

    const handleStopAnalysis = async () => {
        setStatus({ type: 'loading', message: 'Stopping analysis and clearing queue...' });
        try {
            engine.stop();
            engine.terminate();
            await db.games.where('analysisStatus').equals('pending').modify({ analysisStatus: 'idle' });
            await db.games.where('analysisStatus').equals('analyzing').modify({ analysisStatus: 'failed', analysisStartedAt: null, analysisHeartbeatAt: null });
            setStatus({ type: 'success', message: 'Analysis stopped. Pending queue cleared and analyzing games reset.' });
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
        setBookStatus({ type: 'loading', message: 'Syncing book moves...' });
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
                const game = await db.games.get(opening.sampleGameId);
                if (!game?.pgn) continue;

                const base = new Chess();
                base.loadPgn(game.pgn);
                const header = base.header();
                const initFen = header['FEN'] || 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
                const moves = base.history({ verbose: true });

                const walk = new Chess(initFen);
                const masterMoveByFen = {};
                const masterMovesAll = new Set();
                const seenKeys = new Set();

                // Fetch book moves for early positions in the opening (pre-move positions).
                const plyTarget = Math.min(14, moves.length);
                for (let j = 0; j <= plyTarget; j++) {
                    const fen = walk.fen();
                    const key = fenKey(fen);
                    if (key && !seenKeys.has(key)) {
                        const data = await fetchMasterGames(fen);
                        const masterMoves = (data.moves || [])
                            .map((m) => (typeof m === 'string' ? m : m.uci))
                            .filter(Boolean);
                        masterMoveByFen[key] = masterMoves;
                        masterMoves.forEach((m) => masterMovesAll.add(m));
                        seenKeys.add(key);
                        await new Promise((r) => setTimeout(r, 120));
                    }

                    const nextMove = moves[j];
                    if (!nextMove) break;
                    walk.move({ from: nextMove.from, to: nextMove.to, promotion: nextMove.promotion });
                }

                const masterMoves = Array.from(masterMovesAll);
                await db.openings.put({
                    eco: opening.eco,
                    name: opening.name,
                    masterMoves,
                    masterMoveByFen
                });

            }

            setBookStatus({ type: 'success', message: 'Book moves synced for openings.' });
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

                <div className="grid grid-cols-3 gap-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)' }}>
                    <div className="p-4 rounded-lg border bg-panel text-center">
                        <div className="text-xs text-muted uppercase tracking-wider mb-1">Total Games</div>
                        <div className="text-2xl font-bold text-primary">{stats.total}</div>
                    </div>
                    <div className="p-4 rounded-lg border bg-panel text-center">
                        <div className="text-xs text-muted uppercase tracking-wider mb-1">Hero Games</div>
                        <div className="text-2xl font-bold text-primary">{stats.heroTotal}</div>
                    </div>
                    <div className="p-4 rounded-lg border bg-panel text-center">
                        <div className="text-xs text-muted uppercase tracking-wider mb-1">Pending</div>
                        <div className="text-2xl font-bold text-primary">{stats.pending}</div>
                    </div>
                </div>

                <div className="p-6 rounded-lg border bg-panel">
                    <h3 className="text-sm font-semibold text-primary mb-3">Re-analyze All Games</h3>
                    <p className="text-sm text-secondary mb-4">
                        Rebuild all analysis data using the latest engine logic. This will refresh motifs,
                        phases, missed wins/defenses, and reels scheduling.
                    </p>
                    <button className="btn btn-primary" onClick={handleReanalyzeAll}>
                        Re-analyze All
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
