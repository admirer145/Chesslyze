import React, { useState, useEffect, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { db } from '../../services/db';
import { BookOpen, ChevronRight } from 'lucide-react';
import { Chess } from 'chess.js';
import { parsePGN } from '../../services/pgn';
import { useHeroProfiles } from '../../hooks/useHeroProfiles';
import { getHeroSideFromGame, isHeroGameForProfiles } from '../../services/heroProfiles';

const fetchMasterGames = async (fen) => {
    const url = `https://explorer.lichess.ovh/masters?fen=${encodeURIComponent(fen)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to fetch master games');
    return await res.json();
};

const DEFAULT_START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const fenKey = (fen) => {
    if (!fen || typeof fen !== 'string') return '';
    return fen.split(' ').slice(0, 4).join(' ');
};

const deriveOpeningFen = (pgn, plyTarget = 10) => {
    if (!pgn) return '';
    const base = new Chess();
    base.loadPgn(pgn, { sloppy: true });
    const header = base.header();
    const initFen = header['FEN'] || DEFAULT_START_FEN;
    const moves = base.history({ verbose: true });
    const walk = new Chess(initFen);
    const target = Math.min(plyTarget, moves.length);
    for (let i = 0; i < target; i++) {
        const m = moves[i];
        if (m) walk.move({ from: m.from, to: m.to, promotion: m.promotion });
    }
    return walk.fen();
};

const hashPgn = (pgn) => {
    let hash = 5381;
    for (let i = 0; i < pgn.length; i++) {
        hash = (hash * 33) ^ pgn.charCodeAt(i);
    }
    return `pgn_${(hash >>> 0).toString(16)}`;
};

const normalizePgnPayload = (raw) => {
    const trimmed = (raw || '').trim();
    if (!trimmed) return '';
    if (trimmed.startsWith('{')) {
        try {
            const parsed = JSON.parse(trimmed);
            if (parsed?.pgn) return String(parsed.pgn).trim();
        } catch {
            // Fall through to raw payload
        }
    }
    return trimmed;
};

const fetchMasterPgn = async (gameId) => {
    const candidates = [
        `https://explorer.lichess.ovh/masters/pgn/${encodeURIComponent(gameId)}`,
        `https://explorer.lichess.ovh/master/pgn/${encodeURIComponent(gameId)}`
    ];

    let lastError = null;
    for (const url of candidates) {
        try {
            const res = await fetch(url);
            if (!res.ok) {
                lastError = new Error(`Failed to fetch master PGN (${res.status})`);
                continue;
            }
            const text = await res.text();
            const pgn = normalizePgnPayload(text);
            if (pgn) return pgn;
            lastError = new Error('Empty master PGN response.');
        } catch (err) {
            lastError = err;
        }
    }
    throw lastError || new Error('Failed to fetch master PGN.');
};

const findFenMoveIndex = (pgn, targetKey) => {
    if (!pgn || !targetKey) return -1;
    try {
        const base = new Chess();
        base.loadPgn(pgn, { sloppy: true });
        const header = base.header();
        const initFen = header['FEN'] || DEFAULT_START_FEN;
        const moves = base.history({ verbose: true });
        const walk = new Chess(initFen);
        for (let i = 0; i < moves.length; i++) {
            const m = moves[i];
            if (!m) continue;
            walk.move({ from: m.from, to: m.to, promotion: m.promotion });
            if (fenKey(walk.fen()) === targetKey) return i;
        }
    } catch (err) {
        console.warn('Failed to derive jump index', err);
    }
    return -1;
};

const OpeningDetail = ({ opening }) => {
    const navigate = useNavigate();
    const [masterData, setMasterData] = useState(null);
    const [masterLoading, setMasterLoading] = useState(false);
    const [masterError, setMasterError] = useState(null);
    const [masterGameLoadingId, setMasterGameLoadingId] = useState(null);
    const [openingFen, setOpeningFen] = useState('');
    const [openingFenKey, setOpeningFenKey] = useState('');
    const loadOpeningPgn = async () => {
        if (!opening?.sampleGameId) return '';
        try {
            const content = await db.gameContent.get(opening.sampleGameId);
            if (content?.pgn) return content.pgn;
        } catch {
            // ignore and fall back
        }
        const game = await db.games.get(opening.sampleGameId);
        return game?.pgn || '';
    };

    const cachedEntry = useLiveQuery(async () => {
        if (!opening?.eco) return null;
        const entry = await db.openings.get(opening.eco);
        if (entry?.masterData) {
            setMasterData(entry.masterData); // Auto-load from cache if available
        }
        return entry;
    }, [opening?.eco]);
    const total = opening?.total || 0;
    const winRate = total ? Math.round(((opening?.wins || 0) / total) * 100) : 0;
    const lossRate = total ? Math.round(((opening?.losses || 0) / total) * 100) : 0;
    const drawRate = total ? Math.round(((opening?.draws || 0) / total) * 100) : 0;

    const loadMasterGames = async () => {
        if (!opening?.sampleGameId) return;
        setMasterLoading(true);
        setMasterError(null);
        try {
            let fen = openingFen;
            if (!fen) {
                const pgn = await loadOpeningPgn();
                if (!pgn) {
                    setMasterError('No PGN available for this opening yet.');
                    return;
                }
                fen = deriveOpeningFen(pgn);
                if (fen) {
                    setOpeningFen(fen);
                    setOpeningFenKey(fenKey(fen));
                }
            }
            if (!fen) throw new Error('No opening position found');
            const data = await fetchMasterGames(fen);
            setMasterData(data);

            const cached = await db.openings.get(opening.eco);
            const masterMoves = (data.moves || [])
                .map((m) => (typeof m === 'string' ? m : (m.san || m.uci)))
                .filter(Boolean)
                .slice(0, 10);

            await db.openings.put({
                ...cached,
                eco: opening.eco,
                name: opening.name || cached?.name || 'Unknown Opening',
                masterData: data,
                masterMoves,
                updatedAt: new Date().toISOString()
            });
        } catch (err) {
            console.error(err);
            setMasterError('Failed to load master games.');
        } finally {
            setMasterLoading(false);
        }
    };

    useEffect(() => {
        let active = true;
        const loadFen = async () => {
            setOpeningFen('');
            setOpeningFenKey('');
            if (!opening?.sampleGameId) return;
            try {
                const pgn = await loadOpeningPgn();
                if (!pgn) return;
                const fen = deriveOpeningFen(pgn);
                if (!active) return;
                setOpeningFen(fen);
                setOpeningFenKey(fenKey(fen));
            } catch (err) {
                console.warn('Failed to derive opening FEN', err);
            }
        };
        loadFen();
        return () => {
            active = false;
        };
    }, [opening?.sampleGameId]);

    useEffect(() => {
        setMasterData(null);
        setMasterError(null);
        setMasterGameLoadingId(null);
    }, [opening?.eco]);

    const upsertMasterGame = async (pgn) => {
        const pgnHash = hashPgn(pgn);
        const existing = await db.games.where('pgnHash').equals(pgnHash).first();
        if (existing?.id) return existing.id;

        const parsed = parsePGN(pgn);
        if (!parsed) throw new Error('Invalid PGN');

        const date = parsed.date || new Date(parsed.timestamp || Date.now()).toISOString();
        const record = {
            ...parsed,
            date,
            pgn,
            pgnHash,
            isHero: false,
            source: 'master',
            importTag: opening?.eco ? `master:${opening.eco}` : 'master'
        };

        if (!record.eco && opening?.eco) record.eco = opening.eco;
        if ((!record.openingName || record.openingName === 'Unknown Opening') && opening?.name) {
            record.openingName = opening.name;
        }

        return await db.games.add(record);
    };

    const ensureOpeningFenKey = async () => {
        if (openingFenKey) return openingFenKey;
        if (!opening?.sampleGameId) return '';
        try {
            const pgn = await loadOpeningPgn();
            if (!pgn) return '';
            const fen = deriveOpeningFen(pgn);
            const key = fenKey(fen);
            setOpeningFen(fen);
            setOpeningFenKey(key);
            return key;
        } catch (err) {
            console.warn('Failed to derive opening FEN key', err);
            return '';
        }
    };

    const handleOpenMasterGame = async (game) => {
        if (!game?.id) return;
        if (masterGameLoadingId) return;
        setMasterGameLoadingId(game.id);
        setMasterError(null);
        try {
            const pgn = await fetchMasterPgn(game.id);
            const storedGameId = await upsertMasterGame(pgn);

            const key = await ensureOpeningFenKey();
            const jumpIndex = key ? findFenMoveIndex(pgn, key) : -1;

            localStorage.setItem('activeGameId', String(storedGameId));
            if (jumpIndex >= 0) {
                localStorage.setItem('activeGameJumpGameId', String(storedGameId));
                localStorage.setItem('activeGameJumpMoveIndex', String(jumpIndex));
            }
            window.dispatchEvent(new Event('activeGameChanged'));
            navigate('/');
        } catch (err) {
            console.error(err);
            setMasterError('Failed to load master game.');
        } finally {
            setMasterGameLoadingId(null);
        }
    };

    const openUserGame = (gameId) => {
        if (!gameId) return;
        localStorage.setItem('activeGameId', String(gameId));
        window.dispatchEvent(new Event('activeGameChanged'));
        navigate('/');
    };

    if (!opening) {
        return (
            <div className="h-full flex flex-col items-center justify-center text-muted text-center p-8">
                <BookOpen size={48} className="mb-4 opacity-20" />
                <p>Select an opening from the list to analyze performance.</p>
            </div>
        );
    }

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

            <div className="opening-stats-grid-3 grid text-center text-sm mb-12 gap-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)' }}>
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

            <div className="opening-stats-grid-3 grid gap-4 text-sm mb-8 mt-8" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)' }}>
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

            <div className="opening-stats-grid-2 grid gap-6 mb-8" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)' }}>
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
                <div className="opening-stats-grid-2 grid gap-4 text-sm" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)' }}>
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
                        <button
                            key={game.id}
                            type="button"
                            className="p-3 rounded bg-subtle flex items-center justify-between text-sm"
                            onClick={() => openUserGame(game.id)}
                            disabled={!game.id}
                        >
                            <div>
                                <div className="text-primary font-semibold">{game.white} vs {game.black}</div>
                                <div className="text-xs text-muted">{game.date ? new Date(game.date).toLocaleDateString() : 'Unknown date'}</div>
                            </div>
                            <div className="text-xs text-secondary">Accuracy {game.accuracy}%</div>
                        </button>
                    )) : (
                        <div className="text-sm text-muted">No analyzed games yet for deep dive.</div>
                    )}
                </div>
            </div>

            <div className="p-6 rounded-lg border bg-panel mb-8">
                <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-semibold text-primary">Master Games & Book Moves</h4>
                    <button className="btn btn-secondary text-xs" onClick={loadMasterGames} disabled={masterLoading}>
                        {masterLoading ? (
                            <span className="flex items-center gap-2">
                                <div className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                                Fetching...
                            </span>
                        ) : (
                            'Refresh'
                        )}
                    </button>
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
                        {(masterData.topGames || []).length ? (
                            <div className="master-games-list">
                                <div className="master-games-header">
                                    <span>Top Master Games</span>
                                    <span className="master-games-count">{Math.min(5, masterData.topGames.length)}</span>
                                </div>
                                {(masterData.topGames || []).slice(0, 5).map((g, idx) => {
                                    const whiteName = g?.white?.name || g?.white || 'White';
                                    const blackName = g?.black?.name || g?.black || 'Black';
                                    const winnerRaw = (g?.winner || '').toString().toLowerCase();
                                    const winnerLabel = winnerRaw === 'white'
                                        ? 'White wins'
                                        : winnerRaw === 'black'
                                            ? 'Black wins'
                                            : winnerRaw === 'draw'
                                                ? 'Draw'
                                                : 'Result n/a';
                                    const winnerClass = winnerRaw === 'white'
                                        ? 'is-white'
                                        : winnerRaw === 'black'
                                            ? 'is-black'
                                            : winnerRaw === 'draw'
                                                ? 'is-draw'
                                                : 'is-unknown';
                                    const isLoading = masterGameLoadingId === g?.id;
                                    return (
                                        <button
                                            key={`${g.id || idx}`}
                                            className="master-game-card disabled:opacity-50 disabled:cursor-not-allowed"
                                            onClick={() => handleOpenMasterGame(g)}
                                            disabled={!g?.id || isLoading}
                                        >
                                            <div className="master-game-card__left">
                                                <div className="master-game-card__players">
                                                    <span className="master-player master-player--white">{whiteName}</span>
                                                    <span className="master-vs">vs</span>
                                                    <span className="master-player master-player--black">{blackName}</span>
                                                </div>
                                                <div className="master-game-card__meta">
                                                    <span>{g.month || g.year || '-'}</span>
                                                    <span className="meta-sep">•</span>
                                                    <span className={`master-winner ${winnerClass}`}>{winnerLabel}</span>
                                                </div>
                                            </div>
                                            <div className="master-game-card__action">
                                                {isLoading ? (
                                                    <>
                                                        <div className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                                                        <span>Loading</span>
                                                    </>
                                                ) : (
                                                    <>
                                                        <span>Open</span>
                                                        <ChevronRight size={14} />
                                                    </>
                                                )}
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="text-sm text-muted">No master games found for this position.</div>
                        )}
                    </div>
                ) : cachedEntry?.masterMoves?.length ? (
                    <div className="flex flex-col gap-3">
                        <div className="flex flex-wrap gap-2">
                            {cachedEntry.masterMoves.slice(0, 6).map((m, idx) => (
                                <span key={`${m}-${idx}`} className="pill">{m}</span>
                            ))}
                        </div>
                        <div className="text-xs text-muted">Cached book moves from a previous refresh.</div>
                    </div>
                ) : (
                    <div className="text-sm text-muted">Click refresh to load book moves and master games.</div>
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
    const SELECTED_ECO_KEY = 'openingExplorerSelectedEco';
    const { activeProfiles } = useHeroProfiles();
    const profileKey = useMemo(() => activeProfiles.map((p) => p.id).join('|'), [activeProfiles]);
    const getPlayerName = (player) => {
        if (!player) return '';
        if (typeof player === 'string') return player;
        return player.name || '';
    };

    const openings = useLiveQuery(async () => {
        if (!activeProfiles.length) return [];
        const allGames = await db.games.toArray();
        const stats = {};

        const heroResult = (game) => {
            const heroSide = getHeroSideFromGame(game, activeProfiles);
            if (!heroSide) return null;
            const isWhite = heroSide === 'white';
            if (game.result === '1/2-1/2') return 'draw';
            if (isWhite && game.result === '1-0') return 'win';
            if (isWhite && game.result === '0-1') return 'loss';
            if (!isWhite && game.result === '0-1') return 'win';
            if (!isWhite && game.result === '1-0') return 'loss';
            return null;
        };

        allGames.forEach(game => {
            const whiteName = getPlayerName(game.white).toLowerCase();
            const blackName = getPlayerName(game.black).toLowerCase();
            const isHeroGame = isHeroGameForProfiles(game, activeProfiles);
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
                const heroSide = getHeroSideFromGame(game, activeProfiles);
                const isWhite = heroSide === 'white';
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
                    const heroSide = getHeroSideFromGame(game, activeProfiles);
                    const isHeroTurn = (entry.turn === 'w' && heroSide === 'white')
                        || (entry.turn === 'b' && heroSide === 'black');
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
    }, [profileKey]);

    const [selectedEco, setSelectedEco] = useState(() => {
        if (typeof window === 'undefined') return null;
        return localStorage.getItem(SELECTED_ECO_KEY) || null;
    });
    const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);

    useEffect(() => {
        const mq = window.matchMedia('(max-width: 768px)');
        const handler = (e) => setIsMobile(e.matches);
        mq.addEventListener('change', handler);
        return () => mq.removeEventListener('change', handler);
    }, []);

    useEffect(() => {
        if (!openings || !openings.length) return;
        if (selectedEco && openings.some((op) => op.eco === selectedEco)) return;
        const nextEco = openings[0]?.eco || null;
        if (nextEco) {
            setSelectedEco(nextEco);
            try {
                localStorage.setItem(SELECTED_ECO_KEY, nextEco);
            } catch {
                // Ignore persistence errors
            }
        }
    }, [openings, selectedEco]);

    if (!openings) return <div className="p-8 text-secondary">Loading openings...</div>;

    const selectedOpening = openings.find(op => op.eco === selectedEco) || openings[0];

    return (
        <div className="opening-explorer-shell flex h-full bg-app overflow-hidden">
            {isMobile ? (
                /* Mobile: horizontal chip scroller + full-height detail */
                <div className="opening-mobile-layout flex flex-col h-full w-full">
                    <div className="opening-chip-scroller">
                        {openings.map(op => {
                            const w = Math.round((op.wins / op.total) * 100);
                            const isSelected = selectedOpening?.eco === op.eco;
                            return (
                                <button
                                    key={op.eco}
                                    onClick={() => {
                                        setSelectedEco(op.eco);
                                        try {
                                            localStorage.setItem(SELECTED_ECO_KEY, op.eco);
                                        } catch {
                                            // Ignore persistence errors
                                        }
                                    }}
                                    className={`opening-chip ${isSelected ? 'is-selected' : ''}`}
                                >
                                    <span className="opening-chip__eco">{op.eco}</span>
                                    <span className="opening-chip__name">{op.name}</span>
                                    <div className="opening-chip__bar">
                                        <div className="opening-chip__bar-fill" style={{ width: `${w}%` }} />
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                    <div className="flex-1 overflow-y-auto">
                        <OpeningDetail opening={selectedOpening} />
                    </div>
                </div>
            ) : (
                /* Desktop: sidebar + detail */
                <>
                    <div className="opening-list-panel border-r bg-panel flex flex-col h-full">
                        <div className="p-4 border-b flex justify-between items-center">
                            <h3 className="font-semibold text-xs uppercase tracking-wider text-muted">My Repertoire</h3>
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
                                        onClick={() => {
                                            setSelectedEco(op.eco);
                                            try {
                                                localStorage.setItem(SELECTED_ECO_KEY, op.eco);
                                            } catch {
                                                // Ignore persistence errors
                                            }
                                        }}
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
                    <div className="opening-detail-panel bg-app overflow-hidden relative">
                        <OpeningDetail opening={selectedOpening} />
                    </div>
                </>
            )}
        </div>
    );
};
