// Debug-enabled worker for DevLab
(function(){

const DEBUG_WRAPPER_HEADER_LINES = 4;

let outputQueue = [];
let drawCommands = [];
let debuggerInstance = null;
let userVariables = {};
let isDebugging = false;

// SimpleDebugger class definition (inline since workers can't import)
class SimpleDebugger {
    constructor() {
        this.breakpoints = new Set();
        this.currentLine = null;
        this.variables = {};
        this.callStack = [];
        this.isPaused = false;
        this.isRunning = false;
        this.stepMode = false;
        this.onBreakpoint = null;
        this.onStep = null;
        this.onVariableUpdate = null;
    }

    instrumentCode(code) {
        const lines = code.split('\n');
        const instrumentedLines = [];
        const executableLines = new Set();
        
        lines.forEach((line, index) => {
            const lineNum = index + 1;
            const trimmed = line.trim();
            
            if (trimmed && !trimmed.startsWith('//')) {
                executableLines.add(lineNum);
                // Preserve original line count by injecting the probe on the same line
                instrumentedLines.push(`await __debugger__.checkBreakpoint(${lineNum}); ${line}`);
            } else {
                instrumentedLines.push(line);
            }
        });
        
        return {
            code: instrumentedLines.join('\n'),
            executableLines
        };
    }

    async checkBreakpoint(lineNumber) {
        this.currentLine = lineNumber;
        
        if (this.breakpoints.has(lineNumber) || this.stepMode) {
            this.isPaused = true;
            this.stepMode = false;
            
            if (this.onBreakpoint) {
                this.onBreakpoint(lineNumber, this.getDebugState());
            }
            
            return await this.waitForResume();
        }
    }

    async waitForResume() {
        return new Promise(resolve => {
            this.resumeCallback = resolve;
        });
    }

    continue() {
        this.isPaused = false;
        if (this.resumeCallback) {
            this.resumeCallback();
            this.resumeCallback = null;
        }
    }

    step() {
        this.stepMode = true;
        this.continue();
    }

    toggleBreakpoint(lineNumber) {
        if (this.breakpoints.has(lineNumber)) {
            this.breakpoints.delete(lineNumber);
        } else {
            this.breakpoints.add(lineNumber);
        }
        return this.breakpoints.has(lineNumber);
    }

    getDebugState() {
        return {
            currentLine: this.currentLine,
            breakpoints: Array.from(this.breakpoints),
            variables: this.variables,
            isPaused: this.isPaused,
            isRunning: this.isRunning
        };
    }

    updateVariables(vars) {
        this.variables = { ...vars };
        if (this.onVariableUpdate) {
            this.onVariableUpdate(this.variables);
        }
    }

    reset() {
        this.currentLine = null;
        this.variables = {};
        this.callStack = [];
        this.isPaused = false;
        this.isRunning = false;
        this.stepMode = false;
        this.resumeCallback = null;
    }
}

// Safe print function - sends output immediately in debug mode
function print(...args) {
    const output = {
        type: 'print',
        data: args.map(arg => String(arg)).join(' ')
    };
    
    outputQueue.push(output);
    
    // In debug mode, send output immediately
    if (isDebugging) {
        self.postMessage({
            type: 'debug_output',
            output: [output]
        });
    }
}

// Safe drawing API - sends commands immediately in debug mode
const draw = {
    circle: (x, y, radius, color) => {
        const cmd = {
            type: 'circle',
            x: Number(x),
            y: Number(y),
            radius: Number(radius),
            color: String(color)
        };
        drawCommands.push(cmd);
        
        if (isDebugging) {
            self.postMessage({
                type: 'debug_draw',
                commands: [cmd]
            });
        }
    },
    text: (text, x, y, color = 'black', size = 16, align = 'left') => {
        const cmd = {
            type: 'text',
            text: String(text),
            x: Number(x),
            y: Number(y),
            color: String(color),
            size: Number(size),
            align: String(align)
        };
        drawCommands.push(cmd);
        
        if (isDebugging) {
            self.postMessage({
                type: 'debug_draw',
                commands: [cmd]
            });
        }
    },
    rect: (x, y, width, height, color) => {
        const cmd = {
            type: 'rect',
            x: Number(x),
            y: Number(y),
            width: Number(width),
            height: Number(height),
            color: String(color)
        };
        drawCommands.push(cmd);
        
        if (isDebugging) {
            self.postMessage({
                type: 'debug_draw',
                commands: [cmd]
            });
        }
    },
    line: (x1, y1, x2, y2, color, width = 2) => {
        const cmd = {
            type: 'line',
            x1: Number(x1),
            y1: Number(y1),
            x2: Number(x2),
            y2: Number(y2),
            color: String(color),
            width: Number(width)
        };
        drawCommands.push(cmd);
        
        if (isDebugging) {
            self.postMessage({
                type: 'debug_draw',
                commands: [cmd]
            });
        }
    },
    clear: () => {
        const cmd = { type: 'clear' };
        drawCommands.push(cmd);
        
        if (isDebugging) {
            self.postMessage({
                type: 'debug_draw',
                commands: [cmd]
            });
        }
    }
};

// Variable tracking proxy
function createVariableProxy() {
    return new Proxy({}, {
        set(target, prop, value) {
            target[prop] = value;
            userVariables[prop] = value;
            if (debuggerInstance) {
                debuggerInstance.updateVariables(userVariables);
            }
            return true;
        },
        get(target, prop) {
            return target[prop];
        }
    });
}

// Listen for messages
self.addEventListener('message', async (e) => {
    const { type, data } = e.data;
    
    switch (type) {
        case 'execute':
            await executeCode(data.code, data.debugMode, data.breakpoints);
            break;
            
        case 'debug_continue':
            if (debuggerInstance) {
                debuggerInstance.continue();
            }
            break;
            
        case 'debug_step':
            if (debuggerInstance) {
                debuggerInstance.step();
            }
            break;
            
        case 'debug_toggle_breakpoint':
            if (debuggerInstance) {
                const hasBreakpoint = debuggerInstance.toggleBreakpoint(data.line);
                self.postMessage({
                    type: 'breakpoint_toggled',
                    line: data.line,
                    hasBreakpoint
                });
            }
            break;
            
        case 'debug_stop':
            // Reset everything
            if (debuggerInstance) {
                debuggerInstance.reset();
            }
            outputQueue = [];
            drawCommands = [];
            userVariables = {};
            isDebugging = false;
            break;
    }
});

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

async function executeCode(code, debugMode, breakpoints) {
    outputQueue = [];
    drawCommands = [];
    userVariables = {};
    isDebugging = debugMode;
    
    // First, try to find multiple syntax errors by parsing code sections
    const errors = findMultipleErrors(code);
    
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
        if (debugMode) {
            // Debug mode execution
            debuggerInstance = new SimpleDebugger();
            
            // Set initial breakpoints
            if (breakpoints && breakpoints.length > 0) {
                breakpoints.forEach(line => {
                    debuggerInstance.breakpoints.add(line);
                });
            }
            
            // Set up debugger callbacks
            debuggerInstance.onBreakpoint = (line, state) => {
                self.postMessage({
                    type: 'debug_paused',
                    line,
                    variables: state.variables,
                    state
                });
            };
            
            debuggerInstance.onVariableUpdate = (vars) => {
                self.postMessage({
                    type: 'debug_variables',
                    variables: vars
                });
            };
            
            // Instrument the code
            const { code: instrumentedCode, executableLines } = debuggerInstance.instrumentCode(code);
            
            // Send executable lines info
            self.postMessage({
                type: 'debug_info',
                executableLines: Array.from(executableLines)
            });
            
            // Create execution context with variable tracking
            const vars = createVariableProxy();
            
            // Create async function with debug support
            const wrappedCode = 
                "return (async function() {\n" +
                "with (vars) {\n" +
                instrumentedCode + "\n" +
                "}\n" +
                "})();\n" +
                "//# sourceURL=devlab-user-code.js";
            const func = new Function(
                'print', 'draw', '__debugger__', 'vars',
                wrappedCode
            );
            
            // Start debugging
            debuggerInstance.isRunning = true;
            self.postMessage({ type: 'debug_started' });
            
            // Execute with await to handle async debugging
            await func(print, draw, debuggerInstance, vars);
            
            // Execution completed
            debuggerInstance.isRunning = false;
            isDebugging = false;
            self.postMessage({
                type: 'debug_completed',
                output: outputQueue,
                drawCommands: drawCommands
            });
            
        } else {
            // Normal execution (non-debug mode)
            const func = new Function('print', 'draw', code);
            func(print, draw);
            
            self.postMessage({
                type: 'success',
                output: outputQueue,
                drawCommands: drawCommands
            });
        }
        
    } catch (error) {
        // Extract line number from error stack, preferring our virtual file label
        let lineNumber = null;
        let columnNumber = null;
        if (error.stack) {
            const stackLines = error.stack.split('\n');
            // Prefer frames from our injected sourceURL
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
        
        // Adjust for wrapper header lines in debug mode
        // V8 stacks for Function constructors include two implicit lines plus our two header lines
        if (debugMode && lineNumber != null) {
            lineNumber = Math.max(1, lineNumber - DEBUG_WRAPPER_HEADER_LINES);
        }
        
        self.postMessage({
            type: 'error',
            error: error.message,
            lineNumber: lineNumber,
            columnNumber: columnNumber,
            stack: error.stack,
            errors: [{ line: lineNumber, message: error.message }]
        });
        
        if (debuggerInstance) {
            debuggerInstance.reset();
        }
        isDebugging = false;
    }
}
})();