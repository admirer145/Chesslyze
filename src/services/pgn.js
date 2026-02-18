import { Chess } from 'chess.js';
import { db, bulkUpsertGames } from './db';

const parseTags = (pgn) => {
    const tags = {};
    if (!pgn) return tags;
    const tagRe = /\[([A-Za-z0-9_]+)\s+"([^\"]*)"\]/g;
    let match;
    while ((match = tagRe.exec(pgn)) !== null) {
        tags[match[1]] = match[2];
    }
    return tags;
};

const normalizeDateParts = (value) => {
    if (!value) return null;
    const raw = value.trim();
    if (!raw || raw.includes('?')) return null;
    const parts = raw.includes('.') ? raw.split('.') : raw.split('-');
    if (parts.length < 3) return null;
    const [y, m, d] = parts;
    if (!y || !m || !d) return null;
    return {
        y,
        m: String(m).padStart(2, '0'),
        d: String(d).padStart(2, '0')
    };
};

const toIsoDate = (dateTag, timeTag) => {
    const parts = normalizeDateParts(dateTag);
    if (!parts) return null;
    const time = timeTag && !timeTag.includes('?') ? timeTag.trim() : '00:00:00';
    const iso = `${parts.y}-${parts.m}-${parts.d}T${time}Z`;
    const dt = new Date(iso);
    if (Number.isNaN(dt.getTime())) return null;
    return dt.toISOString();
};

const parseTimeControl = (value) => {
    if (!value || value === '-' || value === '?') return null;
    const raw = value.trim();
    if (!raw) return null;
    const [baseStr, incStr] = raw.split('+');
    const base = parseInt(baseStr, 10);
    const inc = parseInt(incStr || '0', 10);
    if (!Number.isFinite(base)) return null;
    return { base, inc };
};

const classifySpeed = (timeControl) => {
    if (!timeControl || !Number.isFinite(timeControl.base)) return 'standard';
    const base = timeControl.base;
    if (base < 180) return 'bullet';
    if (base < 600) return 'blitz';
    if (base < 1800) return 'rapid';
    return 'classical';
};

const parseRating = (value) => {
    if (value === null || value === undefined) return null;
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
};

export const splitPgnText = (raw) => {
    if (!raw) return [];
    const normalized = raw.replace(/\r\n/g, '\n').trim();
    if (!normalized) return [];
    // Split on blank lines that precede the next PGN header block
    const chunks = normalized.split(/\n\s*\n(?=\s*\[)/g);
    return chunks.map((chunk) => chunk.trim()).filter(Boolean);
};

const hashPgn = (pgn) => {
    // Simple non-crypto hash to de-dupe imports.
    let hash = 5381;
    for (let i = 0; i < pgn.length; i++) {
        hash = (hash * 33) ^ pgn.charCodeAt(i);
    }
    return `pgn_${(hash >>> 0).toString(16)}`;
};

export const parsePGN = (pgn) => {
    if (!pgn || !pgn.trim()) return null;
    try {
        const chess = new Chess();
        chess.loadPgn(pgn, { sloppy: true });
        const header = chess.header();
        const tags = { ...parseTags(pgn), ...header };

        const isoDate = toIsoDate(tags.UTCDate || tags.Date, tags.UTCTime || tags.Time);
        const timeControl = parseTimeControl(tags.TimeControl);
        const speed = classifySpeed(timeControl);

        return {
            white: tags.White || 'Unknown',
            black: tags.Black || 'Unknown',
            whiteTitle: tags.WhiteTitle || '',
            blackTitle: tags.BlackTitle || '',
            whiteRating: parseRating(tags.WhiteElo),
            blackRating: parseRating(tags.BlackElo),
            result: tags.Result || '1/2-1/2',
            date: isoDate || '',
            timestamp: isoDate ? new Date(isoDate).getTime() : Date.now(),
            eco: tags.ECO || '',
            openingName: tags.Opening || 'Unknown Opening',
            site: tags.Site || 'PGN Import',
            event: tags.Event || '',
            timeControl: tags.TimeControl || '',
            perf: speed,
            speed,
            variant: (tags.Variant || 'standard').toLowerCase(),
            rated: typeof tags.Rated === 'string' ? tags.Rated.toLowerCase() === 'true' : null,
            pgn: pgn,
            analyzed: false,
            analysisStatus: 'idle'
        };
    } catch (e) {
        console.error('Invalid PGN', e);
        return null;
    }
};

export const getGameResult = (game, username) => {
    const isWhite = game.white.toLowerCase() === username.toLowerCase();
    if (game.result === '1-0') return isWhite ? 'win' : 'loss';
    if (game.result === '0-1') return isWhite ? 'loss' : 'win';
    return 'draw';
};

export const importPgnGames = async (rawPgn, options = {}) => {
    const { importTag = '' } = options;
    const chunks = splitPgnText(rawPgn);
    if (!chunks.length) return { imported: 0, skipped: 0, errors: 0 };

    const parsed = [];
    let errors = 0;
    chunks.forEach((chunk) => {
        const game = parsePGN(chunk);
        if (!game) {
            errors += 1;
            return;
        }
        const pgnHash = hashPgn(chunk);
        const date = game.date || new Date(game.timestamp || Date.now()).toISOString();
        parsed.push({
            ...game,
            date,
            pgn: chunk,
            pgnHash,
            platform: 'pgn',
            sourceGameId: pgnHash,
            sourceUrl: typeof game.site === 'string' && game.site.startsWith('http') ? game.site : '',
            isHero: false,
            source: 'pgn',
            importTag: importTag || ''
        });
    });

    if (!parsed.length) return { imported: 0, skipped: 0, errors };

    const uniqueByHash = new Map();
    let dupes = 0;
    parsed.forEach((g) => {
        if (uniqueByHash.has(g.pgnHash)) {
            dupes += 1;
        } else {
            uniqueByHash.set(g.pgnHash, g);
        }
    });

    const uniqueGames = Array.from(uniqueByHash.values());
    const hashes = uniqueGames.map((g) => g.pgnHash).filter(Boolean);
    let existingHashes = new Set();
    if (hashes.length) {
        const existing = await db.games.where('pgnHash').anyOf(hashes).toArray();
        existingHashes = new Set(existing.map((g) => g.pgnHash).filter(Boolean));
    }
    const imported = uniqueGames.filter((g) => !existingHashes.has(g.pgnHash)).length;
    if (uniqueGames.length) {
        await bulkUpsertGames(uniqueGames);
    }

    const skipped = dupes + (uniqueGames.length - imported);
    return { imported, skipped, errors };
};
