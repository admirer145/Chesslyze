import { Chess } from 'chess.js';

export const parsePGN = (pgn) => {
    try {
        const chess = new Chess();
        chess.loadPgn(pgn);
        const header = chess.header();

        return {
            white: header['White'],
            black: header['Black'],
            result: header['Result'],
            date: header['Date'],
            eco: header['ECO'],
            site: header['Site'],
            pgn: pgn,
            // We can add more fields if needed
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
