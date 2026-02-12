/* eslint-disable no-restricted-globals */

// Intercept Stockfish's output mechanism
// stockfish.js (Emscripten) uses postMessage for stdout. We want to capture that.
// Capture original postMessage immediately
const originalPostMessage = self.postMessage;

// Define rawPostMessage using the captured original
const rawPostMessage = (data) => {
    originalPostMessage.call(self, data);
};

let currentJobId = null;
let currentMultiPv = 1;

// This will be called by the engine worker when it emits UCI lines.
self.postMessage = (msg) => {
    // If msg is a string, it's from the engine (e.g., "bestmove ...", "info ...")
    if (typeof msg === 'string') {
        handleEngineOutput(msg);
    } else {
        // Pass through any other messages (though Stockfish usually only sends strings)
        rawPostMessage(msg);
    }
};

let debug = false;
const log = (...args) => { if (debug) console.log(...args); };
const warn = (...args) => { if (debug) console.warn(...args); };

// Handler for parsing raw UCI output into structured messages
const handleEngineOutput = (line) => {
    // debug: log("Engine Output:", line);

    if (line.startsWith('id name')) {
        const name = line.substring('id name'.length).trim();
        rawPostMessage({ type: 'ENGINE_ID', name });
        return;
    }
    if (line.startsWith('option name Use NNUE')) {
        rawPostMessage({ type: 'ENGINE_CAPS', caps: { nnue: true } });
        return;
    }
    if (line.startsWith('option name MultiPV')) {
        rawPostMessage({ type: 'ENGINE_CAPS', caps: { multipv: true } });
        return;
    }

    if (line.startsWith('bestmove')) {
        const parts = line.split(' ');
        const bestMove = parts[1];
        rawPostMessage({ type: 'BEST_MOVE', jobId: currentJobId, move: bestMove });
        currentJobId = null;
    } else if (line.startsWith('info') && line.includes('score')) {
        const parts = line.split(' ');
        let depth = 0, score = 0, mate = null, pv = '', multipv = 1;

        for (let i = 0; i < parts.length; i++) {
            if (parts[i] === 'depth') depth = parseInt(parts[i + 1]);
            if (parts[i] === 'multipv') multipv = parseInt(parts[i + 1]);
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
            evaluation: { depth, score, mate, pv, multipv }
        });
    } else if (line === 'uciok') {
        uciReady = true;
        if (pendingCommands.length) {
            for (const cmd of pendingCommands) {
                if (engine && typeof engine.postMessage === 'function') {
                    engine.postMessage(cmd);
                }
            }
            pendingCommands = [];
        }
    } else if (line === 'readyok') {
        // no-op
    } else if (debug) {
        // Surface raw lines for debugging (errors/info strings)
        rawPostMessage({ type: 'RAW', line });
    }
};

// Legacy placeholders (unused with engine worker approach)
self.exports = self.exports || {};
self.module = self.module || { exports: self.exports };

// Engine instance (dedicated worker)
let engine = null;
let engineReady = false;
let uciReady = false;
let pendingCommands = [];

// Initialize the engine based on version
const initEngine = (version) => {
    // Prevent double initialization
    if (engine) return;

    // Check for required features
    const isSecure = self.crossOriginIsolated;
    const hasSAB = typeof SharedArrayBuffer !== 'undefined';
    log(`Worker: Environment Check - Secure Context: ${isSecure}, SharedArrayBuffer: ${hasSAB}`);

    if (version === '17.1-multi' && (!isSecure || !hasSAB)) {
        warn("Worker: Multi-threaded engine requested but environment is not secure. Fallback to single-threaded?");
        rawPostMessage({ type: 'WARNING', message: "Multi-threaded engine requires secure context (COOP/COEP Headers)." });
    }

    // Use import.meta.url to resolve paths relative to the current module
    // This ensures paths work correctly with Vite's base path configuration (e.g., /Chesslyze/)
    const baseUrl = new URL('.', import.meta.url).href;
    const scriptPath = version === '17.1-multi'
        ? new URL('../../public/stockfish-engine.worker.js#/stockfish-17-multi.wasm', import.meta.url).href
        : new URL('../../public/stockfish-17-single.js', import.meta.url).href;

    try {
        log(`Worker: Spawning engine worker ${scriptPath}...`);
        engine = new Worker(scriptPath, { type: 'classic' });

        engine.onmessage = (e) => {
            const msg = e.data;
            if (typeof msg === 'string') {
                handleEngineOutput(msg);
            } else {
                // Ignore non-string messages from engine
                // console.log("Worker: Engine non-string message:", msg);
            }
        };

        engine.onerror = (err) => {
            console.error("Worker: Engine Worker Error:", err);
            rawPostMessage({ type: 'ERROR', error: err?.message || 'Engine worker error' });
        };

        engineReady = true;
        uciReady = false;
        pendingCommands = [];
        // Kick off UCI handshake
        engine.postMessage('uci');
    } catch (e) {
        console.error("Worker: Failed to spawn engine worker:", e);
        rawPostMessage({ type: 'ERROR', error: e.message });
    }
};


// Main worker message handler (from UI thread)
self.addEventListener('message', (e) => {
    const { type, data, jobId } = e.data;

    const sendToEngine = (cmd) => {
        if (!engineReady) {
            warn("Worker: Engine not ready, buffering or dropping command:", cmd);
            setTimeout(() => sendToEngine(cmd), 500);
            return;
        }

        if (engine && typeof engine.postMessage === 'function') {
            if (!uciReady && cmd !== 'uci') {
                pendingCommands.push(cmd);
                return;
            }
            log("Worker: Sending to engine via worker:", cmd);
            engine.postMessage(cmd);
            return;
        }

        console.error("Worker: No valid way to send message to engine.");
    };

    if (type === 'INIT') {
        const version = data?.version || e.data.version;
        debug = !!(data && data.debug);
        initEngine(version);
    }
    // ... rest of listener

    if (type === 'ANALYZE') {
        currentJobId = jobId;
        log("Worker: Context ANALYZE received, starting processing...");
        // Reset state for new analysis
        // stop previous
        const { fen, depth = 15, multiPv = 1, movetime } = data;
        currentMultiPv = Math.max(1, Math.min(8, parseInt(multiPv, 10) || 1));

        sendToEngine('stop');
        sendToEngine('ucinewgame');
        sendToEngine(`setoption name MultiPV value ${currentMultiPv}`);
        sendToEngine(`position fen ${fen}`);

        let goCmd = `go depth ${depth}`;
        if (movetime && typeof movetime === 'number' && movetime > 0) {
            goCmd += ` movetime ${movetime}`;
        }
        sendToEngine(goCmd);
    }

    if (type === 'SET_OPTIONS') {
        const options = (data && data.options) || [];
        for (const opt of options) {
            if (!opt?.name) continue;
            let val = opt.value;
            if (val === true) val = 'true';
            if (val === false) val = 'false';

            if (val === undefined || val === null) {
                sendToEngine(`setoption name ${opt.name}`);
            } else {
                sendToEngine(`setoption name ${opt.name} value ${val}`);
            }
        }
    }

    if (type === 'STOP') {
        sendToEngine('stop');
        currentJobId = null;
        currentMultiPv = 1;
    }
});
