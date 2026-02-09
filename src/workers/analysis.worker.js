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

// Hack: Define module/exports to capture Stockfish factory
// and hide onmessage to prevent Stockfish from interpreting this as a worker auto-run
self.exports = {};
self.module = { exports: self.exports };
const _tempOnMessage = self.onmessage;
delete self.onmessage; // Temporarily remove handler

importScripts('/stockfish.js');

self.onmessage = _tempOnMessage; // Restore handler

// Capture factory checking multiple locations
const exported = self.module.exports;
// If module.exports is the function itself (common in some builds)
if (typeof exported === 'function') {
    self.Stockfish = exported;
} else if (exported && typeof exported.Stockfish === 'function') {
    self.Stockfish = exported.Stockfish;
} else {
    // Fallback to global or self.exports
    self.Stockfish = self.exports.Stockfish || self.Stockfish;
}

// console.log("Worker: stockfish.js imported. Typeof Stockfish:", typeof self.Stockfish);

// Variables to hold the engine instance
let engine = null;
let engineReady = false;

// Initialization logic for newer Stockfish (Factory pattern)
if (typeof Stockfish === 'function') {
    // console.log("Worker: Detected Stockfish factory.");
    Stockfish({
        locateFile: (path) => {
            if (path.endsWith('.wasm')) return '/stockfish-nnue-16-single.wasm';
            if (path.endsWith('.nnue')) return '/nn-5af11540bbfe.nnue';
            return path;
        },
        print: (text) => {
            // console.log("SF STDOUT:", text);
            handleEngineOutput(text);
        },
        printErr: (text) => {
            // console.error("SF STDERR:", text);
            rawPostMessage({ type: 'LOG', message: "SF STDERR: " + text });
        }
    }).then((sf) => {
        engine = sf;
        engineReady = true;

        // console.log("Worker: Engine Object Keys:", Object.keys(engine));
        // console.log("Worker: Engine postMessage type:", typeof engine.postMessage);
        // console.log("Worker: Engine addMessageListener type:", typeof engine.addMessageListener);

        // Hook into engine output if it supports addMessageListener
        if (typeof engine.addMessageListener === 'function') {
            // console.log("Worker: Adding message listener via API");
            engine.addMessageListener((line) => {
                handleEngineOutput(line);
            });
        }

        // console.log("Worker: Engine initialized via Factory.");

        // Ensure queue is running
        if (typeof engine.unpauseQueue === 'function') {
            console.log("Worker: Unpausing queue...");
            engine.unpauseQueue();
        }

        // Send initial UCI commands
        const sendParams = (cmd) => {
            // console.log(`Worker: Sending '${cmd.trim()}'...`);
            if (typeof engine.onCustomMessage === 'function') {
                engine.onCustomMessage(cmd + '\n');
            } else {
                engine.postMessage(cmd + '\n');
            }
        };

        sendParams('uci');
    }).catch(err => {
        console.error("Worker: Stockfish Factory Initialization Failed:", err);
        rawPostMessage({ type: 'ERROR', error: "Engine Init Failed: " + err });
    });
} else {
    // Legacy fallback or if Stockfish attached to self
    console.warn("Worker: Stockfish factory not found. Assuming global attachment.");
    engineReady = true; // Assume immediate readiness for legacy
}


// Debug: Check if something stole onmessage
// console.log("Worker: onmessage status before hook:", self.onmessage);

// Replace with addEventListener to avoid conflicts
self.addEventListener('message', (e) => {
    const { type, data, jobId } = e.data;
    // console.log(`Worker: Received Message ${type} (Job: ${jobId})`);
    // logCheck(`Received ${type} for ${jobId}`);

    const sendToEngine = (cmd) => {
        if (!engineReady) {
            console.warn("Worker: Engine not ready, buffering or dropping command:", cmd);
            setTimeout(() => sendToEngine(cmd), 500);
            return;
        }

        const msg = cmd + '\n';
        if (engine && typeof engine.onCustomMessage === 'function') {
            engine.onCustomMessage(msg);
        } else if (engine && typeof engine.postMessage === 'function') {
            engine.postMessage(msg);
        } else if (self.postMessage && typeof self.postMessage === 'function') {
            // Fallback for some legacy environments
            // But usually the above covering engine object is enough
            console.error("Worker: No valid way to send message to engine.");
        }
    };

    if (type === 'INIT') {
        sendToEngine('uci');
        sendToEngine('isready');
    }

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
