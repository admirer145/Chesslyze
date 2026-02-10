/* eslint-disable no-restricted-globals */

// Intercept Stockfish's output mechanism
// stockfish.js (Emscripten) uses postMessage for stdout. We want to capture that.
const rawPostMessage = self.postMessage.bind(self);

let currentJobId = null;
let currentMultiPv = 1;

// This will be called by stockfish.js when it wants to "print"
// For new Stockfish (Module/Factory), we might need to hook differently,
// but usually it still tries to postMessage if environment looks like a worker.
// We'll also hook the instance's addMessageListener if available.
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
    // logCheck("Engine Output: " + line);

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
    } else if (line === 'uciok' || line === 'readyok') {
        // Just log for now
        // logCheck("Engine confirmed ready: " + line);
    } else {
        // Unknown or less important message
        // logCheck("Ignored: " + line);
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

// console.log("Worker: Importing stockfish.js...");

// self.exports = {};
// self.module = { exports: self.exports };
// const _tempOnMessage = self.onmessage;
// delete self.onmessage; // Temporarily remove handler

// Dynamic import will happen in INIT
// importScripts('/stockfish.js');

// self.onmessage = _tempOnMessage; // Restore handler

// Capture factory checking multiple locations
// Shim module/exports for legacy stockfish BEFORE any usage
self.exports = self.exports || {};
// We need to keep the reference to the same object so we can check it later
self.module = self.module || { exports: self.exports };

// The check for exported must happen AFTER importScripts in initEngine.
// So we remove the top-level check here.

// console.log("Worker: stockfish.js imported. Typeof Stockfish:", typeof self.Stockfish);

// Engine instance
let engine = null;
let engineReady = false;

// Initialize the engine based on version
const initEngine = (version) => {
    // Prevent double initialization
    if (engine) return;

    // Default: 17.1 Single Threaded (Stable/Compatible)
    // We replace the broken 16.1 with 17.1 Single
    let scriptPath = '/stockfish-17-single.js';
    let wasmPath = '/stockfish-17-single.wasm';
    // ^ Wait, 17.1 single is ALSO multi-part?
    // Based on LS, yes: stockfish-17.1-single-a496a04-part-0.wasm
    // So both are multi-part now.

    let isMultiPart = true;

    if (version === '17.1-multi') {
        scriptPath = '/stockfish-17-multi.js';
        isMultiPart = true;
    } else {
        // Default / '17.1-single' / legacy mapped to 17.1-single
        scriptPath = '/stockfish-17-single.js';
        isMultiPart = true;
    }

    // Hack for legacy Stockfish (16.1) which might expect module.exports or self.exports
    // (Handled at top level now)

    // Hook fetch to intercept WASM part requests from the multi-part loader
    // The loader in 17.1 derives path from self.location, which is wrong for the worker.
    const originalFetch = self.fetch;
    self.fetch = (input, init) => {
        let url = input;
        if (typeof input === 'string') {
            url = input;
        } else if (input instanceof Request) {
            url = input.url;
        }

        if (url.includes('part-') && url.endsWith('.wasm')) {
            // It's likely a Stockfish part request
            // derived path might look like ".../analysis.worker-part-0.wasm"
            // We want to redirect to our correct script base

            // Extract the part number
            const match = url.match(/part-(\d+)\.wasm/);
            if (match) {
                const partNum = match[1];
                const base = scriptPath.replace('.js', ''); // e.g. /stockfish-17-single
                const newUrl = `${base}-part-${partNum}.wasm`; // e.g. /stockfish-17-single-part-0.wasm
                console.log(`Worker: Redirecting fetch ${url} -> ${newUrl}`);
                return originalFetch(newUrl, init);
            }
        }

        return originalFetch(input, init);
    };

    // Configure global Module for the auto-running Emscripten script
    self.Module = {
        locateFile: (path) => {
            // Debug log
            const debugPath = path;

            if (isMultiPart) {
                const base = scriptPath.replace('.js', ''); // e.g. /stockfish-17-single

                // Check for "part" anywhere in filename
                if (path.includes('part')) {
                    // Try to extract the number
                    // Matches "part-0", "part0", ".0.wasm" etc depending on emscripten version
                    // But our files are named ...-part-X.wasm
                    // The loader likely asks for "stockfish-17.1-single...part-0.wasm"
                    const match = path.match(/part-?(\d+)/);
                    if (match) {
                        const num = match[1];
                        const final = `${base}-part-${num}.wasm`;
                        // console.log(`Worker locateFile: mapped ${debugPath} -> ${final}`);
                        return final;
                    }
                }

                if (path.endsWith('.wasm')) {
                    // console.log(`Worker locateFile: mapped ${debugPath} -> ${base}.wasm (fallback)`);
                    return `${base}.wasm`;
                }
                return path;
            }
            // Legacy/Default fallback
            if (path.endsWith('.wasm')) return wasmPath;
            if (path.endsWith('.nnue')) return nnuePath;
            return path;
        },
        print: (text) => {
            handleEngineOutput(text);
        },
        printErr: (text) => {
            console.warn("SF STDERR:", text);
        }
    };

    try {
        console.log(`Worker: Importing ${scriptPath} with WASM path strategy...`);
        importScripts(scriptPath);
    } catch (e) {
        console.error("Worker: Failed to import script:", e);
        rawPostMessage({ type: 'ERROR', error: "Failed to load engine script: " + e.message });
        return;
    }

    // Check module.exports for the factory
    const exported = self.module.exports;
    if (typeof exported === 'function') {
        self.Stockfish = exported;
    } else if (exported && typeof exported.Stockfish === 'function') {
        self.Stockfish = exported.Stockfish;
    } else {
        // Fallback to global or self.exports
        self.Stockfish = self.exports.Stockfish || self.Stockfish;
    }

    if (typeof self.Stockfish !== 'function') {
        // Check if engine auto-initialized via onmessage
        if (engineMessageHandler) {
            console.log("Worker: Engine auto-initialized via onmessage.");
            engineReady = true;
            // Send UCI init
            if (typeof engineMessageHandler === 'function') {
                engineMessageHandler({ data: 'uci' });
            }
            return;
        }

        console.warn("Worker: Stockfish factory not found. Waiting for auto-init...");
        // It might be async (17.1 single waits for fetch). 
        // We set a timeout to check again or assume the onmessage setter will trigger engineReady.
        return;
    }

    self.Stockfish({
        // locateFile is now handled by global Module, but we can keep it here for redundancy if the factory ignores global.
        // However, usually one is enough. Let's rely on the global Module being set correct.
    }).then((sf) => {
        engine = sf;
        engineReady = true;

        if (typeof engine.addMessageListener === 'function') {
            engine.addMessageListener((line) => {
                handleEngineOutput(line);
            });
        }

        if (typeof engine.unpauseQueue === 'function') {
            engine.unpauseQueue();
        }

        // Send initial UCI commands
        const sendParams = (cmd) => {
            if (typeof engine.onCustomMessage === 'function') {
                engine.onCustomMessage(cmd + '\n');
            } else {
                engine.postMessage(cmd + '\n');
            }
        };

        sendParams('uci');
    }).catch(err => {
        console.error("Worker: Stockfish Initialization Failed:", err);
        rawPostMessage({ type: 'ERROR', error: "Engine Init Failed: " + err });
    });
};


// Intercept onmessage assignment by the engine script
let engineMessageHandler = null;
try {
    Object.defineProperty(self, 'onmessage', {
        set: (handler) => {
            console.log("Worker: Engine set onmessage handler (captured)");
            engineMessageHandler = handler;
            engineReady = true;
        },
        get: () => engineMessageHandler
    });
} catch (e) {
    console.warn("Worker: Could not hook onmessage property", e);
}

// Replace with addEventListener to avoid conflicts
// (self.onmessage is now our property accessor)
self.addEventListener('message', (e) => {
    const { type, data, jobId } = e.data;

    const sendToEngine = (cmd) => {
        if (!engineReady) {
            console.warn("Worker: Engine not ready, buffering or dropping command:", cmd);
            setTimeout(() => sendToEngine(cmd), 500);
            return;
        }

        const msg = cmd + '\n';

        // Priority 1: Captured onmessage handler (Auto-init engines like 17.1)
        if (engineMessageHandler && typeof engineMessageHandler === 'function') {
            engineMessageHandler({ data: msg });
            return;
        }

        // Priority 2: Factory-created instance
        if (engine && typeof engine.onCustomMessage === 'function') {
            engine.onCustomMessage(msg);
        } else if (engine && typeof engine.postMessage === 'function') {
            engine.postMessage(msg);
        } else if (self.postMessage && typeof self.postMessage === 'function') {
            // This is risky as it might send to main thread, but some engines output via postMessage
            console.error("Worker: No valid way to send message to engine.");
        }
    };

    if (type === 'INIT') {
        const version = data?.version || e.data.version;
        initEngine(version);
    }
    // ... rest of listener

    if (type === 'ANALYZE') {
        currentJobId = jobId;
        const { fen, depth = 15, multiPv = 1 } = data;
        currentMultiPv = Math.max(1, Math.min(8, parseInt(multiPv, 10) || 1));

        sendToEngine('stop');
        sendToEngine('ucinewgame');
        sendToEngine(`setoption name MultiPV value ${currentMultiPv}`);
        sendToEngine(`position fen ${fen}`);
        sendToEngine(`go depth ${depth}`);
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
