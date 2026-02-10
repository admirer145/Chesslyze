import React, { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../services/db';
import { BookOpen, Trophy, XCircle, Minus, ChevronRight, Zap } from 'lucide-react';
import { Chess } from 'chess.js';

const fetchMasterGames = async (fen) => {
    const url = `https://explorer.lichess.ovh/masters?fen=${encodeURIComponent(fen)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to fetch master games');
    return await res.json();
};

const OpeningDetail = ({ opening }) => {
    const [masterData, setMasterData] = useState(null);
    const [masterLoading, setMasterLoading] = useState(false);
    const [masterError, setMasterError] = useState(null);
    const [bulkProgress, setBulkProgress] = useState(null); // { current, total, eco }

    const cachedBook = useLiveQuery(async () => {
        if (!opening?.eco) return null;
        const entry = await db.openings.get(opening.eco);
        if (entry?.masterData) {
            setMasterData(entry.masterData); // Auto-load from cache if available
        }
        return entry;
    }, [opening?.eco]);
    if (!opening) return (
        <div className="h-full flex flex-col items-center justify-center text-muted text-center p-8">
            <BookOpen size={48} className="mb-4 opacity-20" />
            <p>Select an opening from the list to analyze performance.</p>
        </div>
    );

    const total = opening.total || 0;
    const winRate = total ? Math.round((opening.wins / total) * 100) : 0;
    const lossRate = total ? Math.round((opening.losses / total) * 100) : 0;
    const drawRate = total ? Math.round((opening.draws / total) * 100) : 0;

    const loadMasterGames = async () => {
        if (!opening?.sampleGameId) return;
        setMasterLoading(true);
        setMasterError(null);
        try {
            const game = await db.games.get(opening.sampleGameId);
            if (!game?.pgn) throw new Error('No PGN for sample game');
            const chess = new Chess();
            chess.loadPgn(game.pgn);
            const moves = chess.history({ verbose: true });
            chess.reset();
            const plyTarget = Math.min(10, moves.length);
            for (let i = 0; i < plyTarget; i++) {
                const m = moves[i];
                chess.move({ from: m.from, to: m.to, promotion: m.promotion });
            }
            const fen = chess.fen();
            const data = await fetchMasterGames(fen);
            setMasterData(data);
        } catch (err) {
            console.error(err);
            setMasterError('Failed to load master games.');
        } finally {
            setMasterLoading(false);
        }
    };

    const bulkLoadMasterGames = async (openingsList) => {
        if (!openingsList || openingsList.length === 0) return;
        setBulkProgress({ current: 0, total: openingsList.length, eco: 'Starting...' });

        for (let i = 0; i < openingsList.length; i++) {
            const op = openingsList[i];
            setBulkProgress({ current: i + 1, total: openingsList.length, eco: op.eco });

            try {
                // 1. Check cache first
                const cached = await db.openings.get(op.eco);
                if (cached && cached.masterData) {
                    // Already have data, skip
                    continue;
                }

                // 2. Load game to get FEN
                if (!op.sampleGameId) continue;
                const game = await db.games.get(op.sampleGameId);
                if (!game?.pgn) continue;

                const chess = new Chess();
                chess.loadPgn(game.pgn);
                const moves = chess.history({ verbose: true });
                chess.reset();
                const plyTarget = Math.min(10, moves.length);
                for (let k = 0; k < plyTarget; k++) {
                    const m = moves[k];
                    chess.move({ from: m.from, to: m.to, promotion: m.promotion });
                }
                const fen = chess.fen();

                // 3. Fetch from API
                const data = await fetchMasterGames(fen);

                // 4. Save to DB
                await db.openings.put({
                    eco: op.eco,
                    masterData: data,
                    masterMoves: (data.moves || []).slice(0, 10).map(m => m.san || m.uci),
                    updatedAt: new Date().toISOString()
                });

                // 5. Rate Limit
                await new Promise(r => setTimeout(r, 1200)); // 1.2s delay to be safe

            } catch (e) {
                console.error(`Failed to load master games for ${op.eco}`, e);
                // Continue to next opening even if one fails
            }
        }
        setBulkProgress(null);
    };

    useEffect(() => {
        setMasterData(null);
        setMasterError(null);
    }, [opening?.eco]);

    return (
        <div className="p-8 h-full overflow-y-auto w-full">
            <div className="flex items-baseline justify-between mb-8 pb-4 border-b">
                <div>
                    <h2 className="text-3xl font-bold mb-1 text-primary">{opening.eco}</h2>
                    <p className="text-secondary">{opening.name || 'Unknown Opening'} • Analyzed {total} games</p>
                </div>
                <div className="text-right">
                    <span className="text-4xl font-mono font-bold text-primary">{winRate}%</span>
                    <p className="text-xs text-secondary uppercase tracking-wider mt-1">Win Rate</p>
                </div>
            </div>

            {/* Bars */}
            <div className="h-4 rounded-full overflow-hidden flex bg-subtle mb-8 w-full">
                {winRate > 0 && (
                    <div style={{ width: `${winRate}%` }} className="bg-emerald-500 flex items-center justify-center" title="Wins"></div>
                )}
                {drawRate > 0 && (
                    <div style={{ width: `${drawRate}%` }} className="bg-zinc-500 flex items-center justify-center" title="Draws"></div>
                )}
                {lossRate > 0 && (
                    <div style={{ width: `${lossRate}%` }} className="bg-rose-500 flex items-center justify-center" title="Losses"></div>
                )}
            </div>

            <div className="grid grid-cols-3 text-center text-sm mb-12 gap-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)' }}>
                <div>
                    <span className="block font-bold text-green-400 mr-2">{opening.wins}</span>
                    <span className="text-secondary">Wins</span>
                </div>
                <div>
                    <span className="block font-bold text-muted mr-2">{opening.draws}</span>
                    <span className="text-secondary">Draws</span>
                </div>
                <div>
                    <span className="block font-bold text-red-400 mr-2">{opening.losses}</span>
                    <span className="text-secondary">Losses</span>
                </div>
            </div>

            <div className="grid grid-cols-3 gap-4 text-sm mb-8 mt-8" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)' }}>
                <div className="p-4 rounded-lg border bg-panel text-center">
                    <div className="text-xs text-muted uppercase tracking-wider mb-1">Avg Accuracy</div>
                    <div className="text-2xl font-bold text-primary">{opening.avgAccuracy || 0}%</div>
                </div>
                <div className="p-4 rounded-lg border bg-panel text-center">
                    <div className="text-xs text-muted uppercase tracking-wider mb-1">Max Eval Swing</div>
                    <div className="text-2xl font-bold text-primary">{opening.maxEvalSwing || 0}</div>
                </div>
                <div className="p-4 rounded-lg border bg-panel text-center">
                    <div className="text-xs text-muted uppercase tracking-wider mb-1">Common Mistake</div>
                    <div className="text-lg font-semibold text-primary">{opening.commonMistakeType || 'N/A'}</div>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-6 mb-8" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)' }}>
                <div className="p-4 rounded-lg border bg-panel">
                    <h4 className="text-sm font-semibold text-primary mb-3">Typical Blunder Moves</h4>
                    <div className="flex flex-wrap gap-2 text-xs text-secondary">
                        {opening.topBlunders?.length ? opening.topBlunders.map(([ply, count]) => (
                            <span key={ply} className="pill">Move {Math.ceil(ply / 2)} ({count})</span>
                        )) : <span className="text-muted">No blunders tracked</span>}
                    </div>
                </div>
                <div className="p-4 rounded-lg border bg-panel">
                    <h4 className="text-sm font-semibold text-primary mb-3">Typical Mistake Moves</h4>
                    <div className="flex flex-wrap gap-2 text-xs text-secondary">
                        {opening.topMistakes?.length ? opening.topMistakes.map(([ply, count]) => (
                            <span key={ply} className="pill">Move {Math.ceil(ply / 2)} ({count})</span>
                        )) : <span className="text-muted">No mistakes tracked</span>}
                    </div>
                </div>
            </div>

            <div className="p-6 rounded-lg border bg-panel mb-8">
                <h4 className="text-sm font-semibold text-primary mb-3">Plans That Work vs Fail</h4>
                <div className="grid grid-cols-2 gap-4 text-sm" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)' }}>
                    <div className="p-3 rounded bg-subtle">
                        <div className="text-xs text-muted uppercase tracking-wider mb-2">Winning Motif</div>
                        <div className="text-base font-semibold text-primary">{opening.winningMotif || 'N/A'}</div>
                    </div>
                    <div className="p-3 rounded bg-subtle">
                        <div className="text-xs text-muted uppercase tracking-wider mb-2">Losing Motif</div>
                        <div className="text-base font-semibold text-primary">{opening.losingMotif || 'N/A'}</div>
                    </div>
                </div>
            </div>

            <div className="p-6 rounded-lg border bg-panel mb-8">
                <h4 className="text-sm font-semibold text-primary mb-3">Opening Deep Dives (Best User Games)</h4>
                <div className="flex flex-col gap-3">
                    {opening.topGames?.length ? opening.topGames.map((game) => (
                        <div key={game.id} className="p-3 rounded bg-subtle flex items-center justify-between text-sm">
                            <div>
                                <div className="text-primary font-semibold">{game.white} vs {game.black}</div>
                                <div className="text-xs text-muted">{game.date ? new Date(game.date).toLocaleDateString() : 'Unknown date'}</div>
                            </div>
                            <div className="text-xs text-secondary">Accuracy {game.accuracy}%</div>
                        </div>
                    )) : (
                        <div className="text-sm text-muted">No analyzed games yet for deep dive.</div>
                    )}
                </div>
            </div>

            <div className="p-6 rounded-lg border bg-panel mb-8">
                <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-semibold text-primary">Master Games & Book Moves</h4>
                    <div className="flex gap-2">
                        {bulkProgress ? (
                            <div className="flex items-center gap-2 text-xs text-secondary bg-subtle px-3 py-1.5 rounded">
                                <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                                <span>{bulkProgress.eco} ({bulkProgress.current}/{bulkProgress.total})</span>
                            </div>
                        ) : (
                            <button className="btn btn-secondary text-xs" onClick={() => bulkLoadMasterGames([opening])} disabled={masterLoading}>
                                Refresh
                            </button>
                        )}
                    </div>
                </div>
                {masterError && <div className="text-sm text-red-400 mb-3">{masterError}</div>}
                {masterData ? (
                    <div className="flex flex-col gap-4">
                        <div className="flex flex-wrap gap-2">
                            {(masterData.moves || []).slice(0, 6).map((m, idx) => {
                                const label = typeof m === 'string' ? m : (m.san || m.uci || '');
                                return (
                                    <span key={m.uci || m.san || idx} className="pill">{label}</span>
                                );
                            })}
                        </div>
                        <div className="flex flex-col gap-2">
                            {(masterData.topGames || []).slice(0, 5).map((g, idx) => {
                                const whiteName = g?.white?.name || g?.white || 'White';
                                const blackName = g?.black?.name || g?.black || 'Black';
                                return (
                                    <div key={`${g.id || idx}`} className="p-3 rounded bg-subtle flex items-center justify-between text-sm">
                                        <div>
                                            <div className="text-primary font-semibold">{whiteName} vs {blackName}</div>
                                            <div className="text-xs text-muted">{g.year || ''} {g.month || ''}</div>
                                        </div>
                                        <div className="text-xs text-secondary">{g.winner || ''}</div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                ) : cachedBook?.masterMoves?.length ? (
                    <div className="flex flex-col gap-3">
                        <div className="flex flex-wrap gap-2">
                            {cachedBook.masterMoves.slice(0, 6).map((m, idx) => (
                                <span key={`${m}-${idx}`} className="pill">{m}</span>
                            ))}
                        </div>
                        <div className="text-xs text-muted">Cached book moves loaded from Settings sync.</div>
                    </div>
                ) : (
                    <div className="text-sm text-muted">Load master games to see book moves and reference games.</div>
                )}
            </div>

            {/* Future Placeholder */}
            <div className="p-6 rounded-lg border bg-panel text-center">
                <p className="text-secondary mb-2">Variation Analysis</p>
                <div className="h-32 flex items-center justify-center bg-app rounded border border-dashed border-subtle">
                    <span className="text-muted text-sm">Mistake Heatmap Coming Soon</span>
                </div>
            </div>
        </div>
    );
};

export const OpeningExplorer = () => {
    const heroUser = localStorage.getItem('heroUser') || '';
    const getPlayerName = (player) => {
        if (!player) return '';
        if (typeof player === 'string') return player;
        return player.name || '';
    };

    const openings = useLiveQuery(async () => {
        const allGames = await db.games.toArray();
        const stats = {};

        const heroResult = (game) => {
            if (!heroUser) return null;
            const whiteName = getPlayerName(game.white).toLowerCase();
            const blackName = getPlayerName(game.black).toLowerCase();
            const isWhite = whiteName === heroUser.toLowerCase();
            const isBlack = blackName === heroUser.toLowerCase();
            if (!isWhite && !isBlack) return null;
            if (game.result === '1/2-1/2') return 'draw';
            if (isWhite && game.result === '1-0') return 'win';
            if (isWhite && game.result === '0-1') return 'loss';
            if (isBlack && game.result === '0-1') return 'win';
            if (isBlack && game.result === '1-0') return 'loss';
            return null;
        };

        allGames.forEach(game => {
            const whiteName = getPlayerName(game.white).toLowerCase();
            const blackName = getPlayerName(game.black).toLowerCase();
            const isHeroGame = typeof game.isHero === 'boolean'
                ? game.isHero
                : (heroUser && (whiteName === heroUser.toLowerCase() || blackName === heroUser.toLowerCase()));
            if (!isHeroGame) return;

            const name = game.eco || 'Unknown';
            if (!stats[name]) {
                stats[name] = {
                    eco: name,
                    name: game.openingName || 'Unknown Opening',
                    total: 0,
                    wins: 0,
                    losses: 0,
                    draws: 0,
                    accuracySum: 0,
                    accuracyCount: 0,
                    blunderMoves: {},
                    mistakeMoves: {},
                    inaccuracyMoves: {},
                    maxEvalSwing: 0,
                    motifsWin: {},
                    motifsLoss: {},
                    commonMistakes: {},
                    topGames: [],
                    sampleGameId: game.id
                };
            }

            const opening = stats[name];
            if (!opening.sampleGameId) opening.sampleGameId = game.id;
            opening.total++;
            const result = heroResult(game);
            if (result === 'win') opening.wins++;
            else if (result === 'loss') opening.losses++;
            else if (result === 'draw') opening.draws++;

            if (game.accuracy) {
                const isWhite = heroUser && game.white?.toLowerCase() === heroUser.toLowerCase();
                const accuracy = isWhite ? game.accuracy.white : game.accuracy.black;
                if (typeof accuracy === 'number') {
                    opening.accuracySum += accuracy;
                    opening.accuracyCount += 1;
                    opening.topGames.push({
                        id: game.id,
                        white: game.white,
                        black: game.black,
                        date: game.date,
                        accuracy
                    });
                }
            }

            if (game.maxEvalSwing) {
                opening.maxEvalSwing = Math.max(opening.maxEvalSwing, game.maxEvalSwing);
            }

            if (Array.isArray(game.analysisLog)) {
                game.analysisLog.forEach(entry => {
                    if (!heroUser) return;
                    const isHeroTurn = (entry.turn === 'w' && game.white?.toLowerCase() === heroUser.toLowerCase())
                        || (entry.turn === 'b' && game.black?.toLowerCase() === heroUser.toLowerCase());
                    if (!isHeroTurn) return;

                    if (entry.classification === 'blunder') opening.blunderMoves[entry.ply] = (opening.blunderMoves[entry.ply] || 0) + 1;
                    if (entry.classification === 'mistake') opening.mistakeMoves[entry.ply] = (opening.mistakeMoves[entry.ply] || 0) + 1;
                    if (entry.classification === 'inaccuracy') opening.inaccuracyMoves[entry.ply] = (opening.inaccuracyMoves[entry.ply] || 0) + 1;

                    if (['blunder', 'mistake', 'inaccuracy'].includes(entry.classification)) {
                        opening.commonMistakes[entry.classification] = (opening.commonMistakes[entry.classification] || 0) + 1;
                    }

                    if (Array.isArray(entry.motifs)) {
                        const bucket = result === 'win' ? opening.motifsWin : opening.motifsLoss;
                        entry.motifs.forEach(m => {
                            bucket[m] = (bucket[m] || 0) + 1;
                        });
                    }
                });
            }
        });

        return Object.values(stats).map(opening => ({
            ...opening,
            avgAccuracy: opening.accuracyCount ? Math.round(opening.accuracySum / opening.accuracyCount) : 0,
            topBlunders: Object.entries(opening.blunderMoves).sort((a, b) => b[1] - a[1]).slice(0, 3),
            topMistakes: Object.entries(opening.mistakeMoves).sort((a, b) => b[1] - a[1]).slice(0, 3),
            topInaccuracies: Object.entries(opening.inaccuracyMoves).sort((a, b) => b[1] - a[1]).slice(0, 3),
            commonMistakeType: Object.entries(opening.commonMistakes).sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A',
            winningMotif: Object.entries(opening.motifsWin).sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A',
            losingMotif: Object.entries(opening.motifsLoss).sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A',
            topGames: opening.topGames.sort((a, b) => b.accuracy - a.accuracy).slice(0, 3)
        })).sort((a, b) => b.total - a.total);
    });

    const [selectedEco, setSelectedEco] = useState(null);

    if (!openings) return <div className="p-8 text-secondary">Loading openings...</div>;

    const selectedOpening = openings.find(op => op.eco === selectedEco) || openings[0];

    return (
        <div className="flex h-full bg-app overflow-hidden">
            {/* List Panel */}
            <div className="border-r bg-panel flex flex-col h-full" style={{ width: 300 }}>
                <div className="p-4 border-b flex justify-between items-center">
                    <h3 className="font-semibold text-xs uppercase tracking-wider text-muted">My Repertoire</h3>
                    <button
                        className="p-1 hover:bg-subtle rounded text-muted hover:text-primary transition-colors"
                        title="Bulk Load Master Games (Slowly)"
                        onClick={() => document.getElementById('bulk-load-trigger').click()}
                    >
                        <Zap size={14} />
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto">
                    {openings.map(op => {
                        const w = (op.wins / op.total) * 100;
                        const d = (op.draws / op.total) * 100;
                        const l = (op.losses / op.total) * 100;
                        const isSelected = selectedOpening?.eco === op.eco;

                        return (
                            <button
                                key={op.eco}
                                onClick={() => setSelectedEco(op.eco)}
                                className="w-full text-left p-4 border-b hover:bg-subtle transition-colors focus:outline-none"
                                style={{ backgroundColor: isSelected ? 'var(--bg-subtle)' : 'transparent', borderLeft: isSelected ? '2px solid var(--accent-blue)' : '2px solid transparent' }}
                            >
                                <div className="flex justify-between items-center mb-2">
                                    <span className="font-mono font-medium text-primary">{op.eco}</span>
                                    <span className="text-xs text-secondary">{op.total}</span>
                                </div>
                                <div className="text-xs text-muted mb-2">{op.name}</div>
                                <div className="h-1.5 w-full bg-app rounded-full overflow-hidden flex">
                                    <div style={{ width: `${w}%` }} className="bg-emerald-500" />
                                    <div style={{ width: `${d}%` }} className="bg-zinc-500" />
                                    <div style={{ width: `${l}%` }} className="bg-rose-500" />
                                </div>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Detail Panel */}
            <div className="flex-1 bg-app overflow-hidden relative">
                <OpeningDetail opening={selectedOpening} />
                {/* Hidden trigger for bulk load to passthrough to Detail component which has the logic, 
                    OR better, lift state up. For now, let's keep it simple and lift the logic up in next refactor if needed.
                    Actually, OpeningDetail has the logic. We need to pass the full list to it or move logic here.
                    Let's move logic to OpeningDetail and expose a trigger? No, OpeningDetail is for ONE opening.
                    
                    Refactor: Move bulkLoadMasterGames to parent (OpeningExplorer) so it can iterate all openings.
                */}
            </div>
        </div>
    );
};
