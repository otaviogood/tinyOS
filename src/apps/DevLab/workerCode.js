let outputQueue = [];
let drawCommands = [];

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

// Listen for code to execute
self.addEventListener('message', (e) => {
    if (e.data.type === 'execute') {
        outputQueue = [];
        drawCommands = [];
        
        try {
            // Create a limited scope for user code
            const func = new Function('print', 'draw', e.data.code);
            func(print, draw);
            
            // Send results back
            self.postMessage({
                type: 'success',
                output: outputQueue,
                drawCommands: drawCommands
            });
        } catch (error) {
            self.postMessage({
                type: 'error',
                error: error.message
            });
        }
    }
}); 