// Engine wrapper for Stockfish 17.1 multithreaded
// Sets up locateFile so pthread workers get a hash with wasm path.

/* eslint-disable no-restricted-globals */

const wasmBase = '/stockfish-17-multi.wasm';

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
        return `/stockfish.worker.js#${wasmBase},worker`;
    }
    if (path.endsWith('.wasm')) {
        return wasmBase;
    }
    return path;
};

importScripts('/stockfish-17-multi.js');
