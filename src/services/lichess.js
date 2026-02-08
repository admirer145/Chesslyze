export const fetchLichessGames = async (username, max = 50, filters = {}) => {
    const params = new URLSearchParams({
        max: max.toString(),
        clocks: 'false',
        opening: 'true',
        evals: 'false',
        pgnInJson: 'true', // Request PGN field explicitly
        perfType: filters.perfType || '',
    });

    if (filters.since) params.append('since', filters.since);
    if (filters.until) params.append('until', filters.until);

    const response = await fetch(`https://lichess.org/api/games/user/${username}?${params.toString()}`, {
        headers: {
            'Accept': 'application/x-ndjson',
        },
    });

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
                    console.error('Failed to parse game JSON', e);
                }
            }
        }
    } catch (err) {
        console.error("Stream reading error", err);
        throw err;
    }

    return games;
};
