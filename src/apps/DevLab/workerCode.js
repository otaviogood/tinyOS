(function(){

const NON_DEBUG_PROLOGUE_LINES = 2;
let outputQueue = [];
let drawCommands = [];
let loopTimer = null;
let isLooping = false;

// Safe print function
function print(...args) {
    outputQueue.push({
        type: 'print',
        data: args.map(arg => String(arg)).join(' ')
    });
}

// Safe drawing API
const draw = {
    circle: (x, y, radius, color) => {
        drawCommands.push({
            type: 'circle',
            x: Number(x),
            y: Number(y),
            radius: Number(radius),
            color: String(color)
        });
    },
    text: (text, x, y, color = 'black', size = 16, align = 'left') => {
        drawCommands.push({
            type: 'text',
            text: String(text),
            x: Number(x),
            y: Number(y),
            color: String(color),
            size: Number(size),
            align: String(align)
        });
    },
    rect: (x, y, width, height, color) => {
        drawCommands.push({
            type: 'rect',
            x: Number(x),
            y: Number(y),
            width: Number(width),
            height: Number(height),
            color: String(color)
        });
    },
    line: (x1, y1, x2, y2, color, width = 2) => {
        drawCommands.push({
            type: 'line',
            x1: Number(x1),
            y1: Number(y1),
            x2: Number(x2),
            y2: Number(y2),
            color: String(color),
            width: Number(width)
        });
    },
    clear: () => {
        drawCommands.push({ type: 'clear' });
    }
};

// Function to find multiple syntax errors in the code (delimiter-aware scanner)
function findMultipleErrors(code) {
    const errors = [];
    
    // Global scan that ignores strings, template literals, and comments
    const stack = [];
    let inSingle = false, inDouble = false, inTemplate = false, inLineComment = false, inBlockComment = false;
    let escape = false;
    let lineNumber = 1;
    const openerFor = { ')': '(', ']': '[', '}': '{' };
    for (let i = 0; i < code.length; i++) {
        const ch = code[i];
        const next = code[i + 1];
        if (ch === '\n') {
            lineNumber++;
            inLineComment = false;
            escape = false;
            continue;
        }
        if (inLineComment) continue;
        if (inBlockComment) {
            if (ch === '*' && next === '/') {
                inBlockComment = false;
                i++;
            }
            continue;
        }
        if (inSingle) {
            if (!escape && ch === "'") inSingle = false;
            escape = ch === '\\' && !escape;
            continue;
        }
        if (inDouble) {
            if (!escape && ch === '"') inDouble = false;
            escape = ch === '\\' && !escape;
            continue;
        }
        if (inTemplate) {
            if (!escape && ch === '`') inTemplate = false;
            // Handle ${ ... } nesting inside template strings
            if (!escape && ch === '$' && next === '{') {
                stack.push({ char: '{', line: lineNumber, fromTemplate: true });
                i++;
                continue;
            }
            escape = ch === '\\' && !escape;
            continue;
        }
        // Not in any string/comment
        if (ch === '/' && next === '/') { inLineComment = true; i++; continue; }
        if (ch === '/' && next === '*') { inBlockComment = true; i++; continue; }
        if (ch === "'") { inSingle = true; escape = false; continue; }
        if (ch === '"') { inDouble = true; escape = false; continue; }
        if (ch === '`') { inTemplate = true; escape = false; continue; }
        if (ch === '(' || ch === '[' || ch === '{') {
            stack.push({ char: ch, line: lineNumber, fromTemplate: false });
            continue;
        }
        if (ch === ')' || ch === ']' || ch === '}') {
            const expected = openerFor[ch];
            const top = stack.pop();
            if (!top || top.char !== expected) {
                errors.push({ line: lineNumber, message: `Unmatched ${ch === '}' ? 'curly braces' : ch === ')' ? 'parentheses' : 'square brackets'}` });
            }
            continue;
        }
    }
    // Any remaining openers are unmatched
    for (const item of stack) {
        errors.push({ line: item.line, message: item.char === '{' ? 'Unmatched curly braces' : item.char === '(' ? 'Unmatched parentheses' : 'Unmatched square brackets' });
    }
    
    // Try to parse the entire code to catch other syntax errors
    try {
        new Function(code);
    } catch (error) {
        // Attempt to extract a line number; if not present, don't override our delimiter findings
        let errLine = null;
        if (error.stack) {
            const m = error.stack.match(/<anonymous>:(\d+):(\d+)/);
            if (m) errLine = parseInt(m[1], 10);
        }
        if (errLine != null) {
            const alreadyFound = errors.some(err => err.line === errLine && err.message === error.message);
            if (!alreadyFound) {
                errors.push({ line: errLine, message: error.message });
            }
        } else {
            if (!errors.length) {
                errors.push({ line: 1, message: error.message });
            }
        }
    }
    
    return errors;
}

// Listen for code to execute
self.addEventListener('message', (e) => {
    if (e.data.type === 'execute') {
        outputQueue = [];
        drawCommands = [];
        isLooping = false;
        if (loopTimer) {
            clearInterval(loopTimer);
            loopTimer = null;
        }
        
        // First, try to find multiple syntax errors by parsing code sections
        const errors = findMultipleErrors(e.data.code);
        
        if (errors.length > 0) {
            // Send all errors found
            self.postMessage({
                type: 'error',
                error: errors.map(err => `Line ${err.line}: ${err.message}`).join('\n'),
                errors: errors,
                lineNumber: errors[0].line
            });
            return;
        }
        
        try {
            // Try to detect Processing-like setup/loop by returning references
            const loader = new Function(
                'print', 'draw',
                e.data.code +
                "\nreturn { setup: (typeof setup==='function'? setup : null), loop: (typeof loop==='function'? loop : (typeof draw==='function'? draw : null)) };\n//# sourceURL=devlab-user-code.js"
            );
            const api = loader(print, draw);

            const hasLoop = api && typeof api.loop === 'function';
            const hasSetup = api && typeof api.setup === 'function';

            if (hasSetup || hasLoop) {
                // Looping mode
                isLooping = true;
                self.postMessage({ type: 'loop_started' });

                try {
                    if (hasSetup) {
                        api.setup();
                    }
                } catch (errSetup) {
                    throw errSetup;
                }

                // Stream frames ~60 FPS
                const fps = 60;
                const intervalMs = Math.max(1, Math.floor(1000 / fps));
                loopTimer = setInterval(() => {
                    try {
                        drawCommands = [];
                        const prevOutputs = outputQueue;
                        outputQueue = [];
                        if (hasLoop) api.loop();
                        // Emit frame
                        const out = prevOutputs.length ? prevOutputs : [];
                        self.postMessage({
                            type: 'frame',
                            output: out,
                            drawCommands: drawCommands
                        });
                    } catch (errFrame) {
                        // Stop loop and report error
                        if (loopTimer) {
                            clearInterval(loopTimer);
                            loopTimer = null;
                        }
                        isLooping = false;
                        self.postMessage({
                            type: 'error',
                            error: errFrame.message,
                            errors: [{ line: null, message: errFrame.message }]
                        });
                    }
                }, intervalMs);
            } else {
                // One-shot mode (legacy)
                const func = new Function('print', 'draw', e.data.code + "\n//# sourceURL=devlab-user-code.js");
                func(print, draw);

                self.postMessage({
                    type: 'success',
                    output: outputQueue,
                    drawCommands: drawCommands
                });
            }
        } catch (error) {
            // Extract line/column preferring our virtual file label
            let lineNumber = null;
            let columnNumber = null;
            if (error.stack) {
                const stackLines = error.stack.split('\n');
                const preferred = stackLines.find(l => l.includes('devlab-user-code.js'));
                const lineToParse = preferred || stackLines.find(l => l.includes('<anonymous>')) || stackLines[0];
                if (lineToParse) {
                    const m = lineToParse.match(/:(\d+):(\d+)/);
                    if (m) {
                        lineNumber = parseInt(m[1], 10);
                        columnNumber = parseInt(m[2], 10);
                    } else {
                        const m2 = lineToParse.match(/line (\d+)/);
                        if (m2) {
                            lineNumber = parseInt(m2[1], 10);
                        }
                    }
                }
            }
            
            // Adjust for engine prologue lines observed in non-debug mode
            if (lineNumber != null) {
                lineNumber = Math.max(1, lineNumber - NON_DEBUG_PROLOGUE_LINES);
            }
            
            self.postMessage({
                type: 'error',
                error: error.message,
                lineNumber: lineNumber,
                columnNumber: columnNumber,
                stack: error.stack,
                errors: [{ line: lineNumber, message: error.message }]
            });
        }
    } else if (e.data.type === 'stop') {
        if (loopTimer) {
            clearInterval(loopTimer);
            loopTimer = null;
        }
        isLooping = false;
        self.postMessage({ type: 'loop_stopped' });
    }
});
})();