/* eslint-disable no-restricted-globals */

// Intercept Stockfish's output mechanism
// stockfish.js (Emscripten) uses postMessage for stdout. We want to capture that.
const rawPostMessage = self.postMessage.bind(self);

let currentJobId = null;

// This will be called by stockfish.js when it wants to "print"
self.postMessage = (msg) => {
    // If msg is a string, it's from the engine (e.g., "bestmove ...", "info ...")
    if (typeof msg === 'string') {
        handleEngineOutput(msg);
    } else {
        // Pass through any other messages (though Stockfish usually only sends strings)
        rawPostMessage(msg);
    }
};

// Log wrapper that sends debug info to main thread or console
const logCheck = (msg) => {
    // Uncomment to debug worker internals in browser console
    // console.log("Worker Middleware:", msg);
}

// Handler for parsing raw UCI output into structured messages
const handleEngineOutput = (line) => {
    logCheck("Engine Output: " + line);

    if (line.startsWith('bestmove')) {
        const parts = line.split(' ');
        const bestMove = parts[1];
        rawPostMessage({ type: 'BEST_MOVE', jobId: currentJobId, move: bestMove });
        currentJobId = null;
    } else if (line.startsWith('info') && line.includes('score')) {
        const parts = line.split(' ');
        let depth = 0, score = 0, mate = null, pv = '';

        for (let i = 0; i < parts.length; i++) {
            if (parts[i] === 'depth') depth = parseInt(parts[i + 1]);
            if (parts[i] === 'score') {
                if (parts[i + 1] === 'cp') score = parseInt(parts[i + 2]);
                if (parts[i + 1] === 'mate') mate = parseInt(parts[i + 2]);
            }
            if (parts[i] === 'pv') {
                pv = parts.slice(i + 1).join(' ');
                break;
            }
        }

        rawPostMessage({
            type: 'INFO',
            jobId: currentJobId,
            evaluation: { depth, score, mate, pv }
        });
    }
};

// Setup Module global to fix WASM path BEFORE importing
// Even if stockfish.js overwrites Module, it might merge or we can try to hook locateFile via this
self.Module = {
    locateFile: (path) => {
        if (path.endsWith('.wasm')) return '/stockfish.wasm';
        return path;
    }
};

console.log("Worker: Importing stockfish.js...");
importScripts('/stockfish.js');
console.log("Worker: stockfish.js imported.");

// Capture the onmessage handler that stockfish.js just assigned
// It usually assigns to global context (self)
const stockfishOnMessage = self.onmessage;

if (!stockfishOnMessage) {
    console.warn("Worker: stockfish.js did not assign an onmessage handler! It might be a different version.");
}

// Replace with our own handler to process commands from Main Thread
self.onmessage = (e) => {
    const { type, data, jobId } = e.data;
    logCheck(`Received ${type} for ${jobId}`);

    if (type === 'INIT') {
        // Send internal initialization if needed, or just warm it up
        if (stockfishOnMessage) {
            stockfishOnMessage({ data: 'uci' });
        }
    }

    if (type === 'ANALYZE') {
        currentJobId = jobId;
        const { fen, depth = 15 } = data;

        if (stockfishOnMessage) {
            stockfishOnMessage({ data: 'position fen ' + fen });
            stockfishOnMessage({ data: 'go depth ' + depth });
        } else {
            console.error("Worker: Cannot parse ANALYZE, engine handler missing.");
        }
    }

    if (type === 'STOP') {
        if (stockfishOnMessage) stockfishOnMessage({ data: 'stop' });
        currentJobId = null;
    }
};
