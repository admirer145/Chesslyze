import { bulkUpsertGames, getLatestGameTimestamp } from './db';

const constructPgn = (game) => {
    const headers = [
        `[Event "${game.tournament || 'Casual'}"]`,
        `[Site "Lichess"]`,
        `[Date "${new Date(game.createdAt).toISOString().split('T')[0]}"]`,
        `[Time "${new Date(game.createdAt).toISOString().split('T')[1].substring(0, 8)}"]`,
        `[UTCDate "${new Date(game.createdAt).toISOString().split('T')[0].replace(/-/g, '.')}"]`,
        `[UTCTime "${new Date(game.createdAt).toISOString().split('T')[1].substring(0, 8)}"]`,
        `[White "${game.players?.white?.user?.name || game.players?.white?.name || 'Anonymous'}"]`,
        `[Black "${game.players?.black?.user?.name || game.players?.black?.name || 'Anonymous'}"]`,
        `[Result "${game.winner ? (game.winner === 'white' ? '1-0' : '0-1') : '1/2-1/2'}"]`,
        `[WhiteElo "${game.players?.white?.rating || '?'}"]`,
        `[BlackElo "${game.players?.black?.rating || '?'}"]`,
        `[Variant "${game.variant || 'Standard'}"]`,
        `[ECO "${game.opening?.eco || '?'}"]`,
        `[Opening "${game.opening?.name || '?'}"]`
    ].join('\n');
    return `${headers}\n\n${game.moves}`;
};

const mapLichessGame = (game) => {
    const pgn = game.pgn || constructPgn(game);
    const speed = game.speed || game.perf || 'standard';
    const timeControl = game.clock ? `${game.clock.initial}+${game.clock.increment}` : '';

    return {
        lichessId: game.id,
        site: 'Lichess',
        date: new Date(game.createdAt).toISOString(),
        white: game.players?.white?.user?.name || game.players?.white?.name || 'Anonymous',
        black: game.players?.black?.user?.name || game.players?.black?.name || 'Anonymous',
        whiteTitle: game.players?.white?.user?.title || '',
        blackTitle: game.players?.black?.user?.title || '',
        whiteRating: game.players?.white?.rating,
        blackRating: game.players?.black?.rating,
        perf: speed,
        speed,
        timeControl,
        result: game.winner ? (game.winner === 'white' ? '1-0' : '0-1') : '1/2-1/2',
        eco: game.opening?.eco || '',
        openingName: game.opening?.name || 'Unknown Opening',
        pgn: pgn,
        timestamp: game.createdAt,
        variant: game.variant || 'standard',
        rated: typeof game.rated === 'boolean' ? game.rated : null,
        tournament: game.tournament || '',
        analyzed: false,
        analysisStatus: 'idle'
    };
};

export const fetchLichessGames = async (username, max = 50, filters = {}) => {
    const params = new URLSearchParams({
        max: max.toString(),
        clocks: 'false',
        opening: 'true',
        evals: 'false',
        pgnInJson: 'true',
    });

    if (filters.since) params.append('since', filters.since.toString());
    if (filters.until) params.append('until', filters.until.toString());
    if (filters.perfType) params.append('perfType', filters.perfType);

    const makeRequest = async (retries = 3, delay = 1000) => {
        try {
            const response = await fetch(`https://lichess.org/api/games/user/${username}?${params.toString()}`, {
                headers: {
                    'Accept': 'application/x-ndjson',
                },
            });

            if (!response.ok) {
                if (response.status === 429) {
                    // Lichess 429 often requires a full minute wait if IP banned, 
                    // but for shorter bursts 30-60s might be needed.
                    // We'll increment delay significantly.
                    const waitTime = delay * 2;
                    console.warn(`Rate limit hit (429). Waiting ${waitTime}ms before retry...`);

                    if (retries > 0) {
                        await new Promise(r => setTimeout(r, waitTime));
                        return makeRequest(retries - 1, waitTime);
                    }
                    throw new Error('Lichess Rate Limit hit. Please wait a minute and try again.');
                }
                throw new Error(`Lichess API error: ${response.statusText}`);
            }
            return response;
        } catch (err) {
            // Retry on network errors (TypeErrors) or specific messages
            const isNetworkError = err instanceof TypeError ||
                err.message.toLowerCase().includes('network') ||
                err.message.toLowerCase().includes('fetch');

            if (retries > 0 && isNetworkError) {
                console.warn(`Network error details: ${err.message}. Retrying in ${delay}ms...`);
                await new Promise(r => setTimeout(r, delay));
                return makeRequest(retries - 1, delay * 2);
            }
            throw err;
        }
    };

    const response = await makeRequest();

    if (!response.body) throw new Error('No response body');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const games = [];

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();

            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const game = JSON.parse(line);
                    games.push(game);
                } catch (e) {
                    console.error('Failed to parse game JSON line:', line, e);
                }
            }
        }
        // Handle last chunk
        if (buffer.trim()) {
            try {
                const game = JSON.parse(buffer);
                games.push(game);
            } catch (e) { }
        }
    } catch (err) {
        console.error("Stream reading error", err);
        throw err;
    }

    return games;
};

export const syncUserGames = async (username, onProgress, options = {}) => {
    let currentSince = 0;
    const now = Date.now();
    // Quarterly chunks (90 days) as requested to reduce request count
    const CHUNK_MS = 90 * 24 * 60 * 60 * 1000;

    if (options.fullSync) {
        // Start from account creation time if available, otherwise default to 0 (all history)
        // But 0 is dangerous (1970), so let's default to a reasonable fallback like 2010 (1262304000000) if no startTime provided
        // or just use 0 if we really must. Better to use options.startTime.
        currentSince = options.startTime || 0;
    } else {
        const latestTimestamp = await getLatestGameTimestamp(username);
        // If we have no latest timestamp, we might be in a "first sync" scenario without fullSync flag?
        // No, usually ImportGames passes fullSync=true for fresh import.
        // If incremental, existing logic holds.
        currentSince = latestTimestamp ? latestTimestamp + 1 : (options.startTime || 0);
    }
    let totalImported = 0;

    onProgress({ type: 'start', message: 'Starting sync...' });

    while (currentSince < now) {
        let currentUntil = currentSince + CHUNK_MS;
        if (currentUntil > now) currentUntil = now;

        const dateFromStr = new Date(currentSince).toLocaleDateString();
        const dateToStr = new Date(currentUntil).toLocaleDateString();

        onProgress({
            type: 'progress',
            message: `Fetching games from ${dateFromStr} to ${dateToStr}...`,
            currentSince,
            currentUntil
        });

        // Add retry logic handling inside fetchLichessGames, so here we just call it.
        // But we should probably add a small delay here too.

        try {
            const rawGames = await fetchLichessGames(username, 100000, {
                since: currentSince,
                until: currentUntil
            });

            if (rawGames.length > 0) {
                const mappedGames = rawGames.map(mapLichessGame);
                await bulkUpsertGames(mappedGames);
                totalImported += mappedGames.length;
                onProgress({ type: 'added', count: mappedGames.length, total: totalImported });
            }
        } catch (err) {
            console.error(`Error fetching chunk ${dateFromStr}-${dateToStr}:`, err);
            onProgress({ type: 'error', message: `Failed chunk ${dateFromStr}: ${err.message}` });
            throw err; // Stop sync on error? Or continue? For rate limits, we should probably stop.
        }

        if (currentUntil >= now) break;
        currentSince = currentUntil; // Move to next chunk

        // Increased delay to 1s to be safer against rate limits
        await new Promise(r => setTimeout(r, 1000));
    }

    onProgress({ type: 'success', message: `Sync complete! Imported ${totalImported} games.` });
    return totalImported;
};

export const fetchLichessUser = async (username) => {
    const response = await fetch(`https://lichess.org/api/user/${username}`);
    if (!response.ok) {
        if (response.status === 404) throw new Error('User not found');
        throw new Error(`Lichess API error: ${response.statusText}`);
    }
    return await response.json();
};
