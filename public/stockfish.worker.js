// Pthread worker stub: load the main engine script.
// The main script detects pthread mode via the worker URL hash.
const resolveBaseUrl = () => {
    try {
        const url = (self.location && self.location.href) ? self.location.href : '';
        const clean = url.split('#')[0].split('?')[0];
        const idx = clean.lastIndexOf('/');
        return idx >= 0 ? clean.slice(0, idx + 1) : '/';
    } catch {
        return '/';
    }
};
const baseUrl = resolveBaseUrl();
importScripts(`${baseUrl}stockfish-17-multi.js`);
