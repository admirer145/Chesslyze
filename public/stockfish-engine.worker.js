// Engine wrapper for Stockfish 17.1 multithreaded
// Sets up locateFile so pthread workers get a hash with wasm path.

/* eslint-disable no-restricted-globals */

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
const wasmBase = `${baseUrl}stockfish-17-multi.wasm`;

self.fetch = (orig => async (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url) || String(input);
    const res = await orig(input, init);
    const ct = res.headers && res.headers.get ? res.headers.get('content-type') : null;
    if (!res.ok || (ct && ct.includes('text/html'))) {
        postMessage(`__SF_FETCH__ ${res.status} ${ct || ''} ${url}`);
    }
    return res;
})(self.fetch);

self.Module = self.Module || {};
self.Module.locateFile = (path) => {
    if (path === 'stockfish.worker.js') {
        // Ensure pthread workers see a hash with wasm path and "worker" flag
        return `${baseUrl}stockfish.worker.js#${wasmBase},worker`;
    }
    if (path.endsWith('.wasm')) {
        return wasmBase;
    }
    return path;
};

importScripts(`${baseUrl}stockfish-17-multi.js`);
