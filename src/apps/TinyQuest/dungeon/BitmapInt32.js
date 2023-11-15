import RandomFast from "../../../random-fast";

export class BitmapInt32 {
    constructor(w, h) {
        this._imageData = null;
        this.data2 = null;
        this.width = w;
        this.height = h;

        this.data2 = new Int32Array(Math.imul(w, h));
    }

    Clear(pix) {
        var size = Math.imul(this.width, this.height);

        for (var i = 0, count = size; i < count; i = (i + 1) | 0) {
            this.data2[i] = pix;
        }
    }

    InRange(x, y) {
        if (x < 0 || y < 0 || x >= this.width || y >= this.height) {
            return false;
        }

        return true;
    }

    GetPixel(x, y) {
        return this.data2[(x + Math.imul(y, this.width)) | 0];
    }

    GetPixelZeroEdge(x, y) {
        if (!this.InRange(x, y)) {
            return 0;
        }

        return this.data2[(x + Math.imul(y, this.width)) | 0];
    }

    GetPixelSafeEdge(x, y, edge) {
        if (!this.InRange(x, y)) {
            return edge;
        }

        return this.data2[(x + Math.imul(y, this.width)) | 0];
    }

    GetPixelIndex(x, y) {
        return (x + Math.imul(y, this.width)) | 0;
    }

    SetPixel(x, y, pix) {
        this.dirty = true;
        this.data2[(x + Math.imul(y, this.width)) | 0] = pix;
    }

    SetPixelSafe(x, y, pix) {
        if (!this.InRange(x, y)) {
            return;
        }

        this.data2[(x + Math.imul(y, this.width)) | 0] = pix;
    }
}

// randomized depth-first search (DFS) algorithm. The general idea is as follows:

// Start at a random cell on the grid and push it to the stack.
// While the stack is not empty:
// a. Pop a cell from the stack.
// b. Get the list of unvisited neighbors of this cell.
// c. If there are unvisited neighbors, choose one randomly, remove the wall between the current cell and the chosen cell, and push both the current cell and the chosen cell onto the stack.
// d. If there are no unvisited neighbors, backtrack to the previous cell.
export class MazeGenerator3 {
    constructor(bitmap) {
        this.bitmap = bitmap;
        this.visited = new BitmapInt32(bitmap.width, bitmap.height);
        this.visited.Clear(0);
    }

    getUnvisitedNeighbors(x, y) {
        const neighbors = [];
        const directions = [
            [0, -2],
            [2, 0],
            [0, 2],
            [-2, 0],
        ]; // Up, Right, Down, Left
        for (const [dx, dy] of directions) {
            const nx = x + dx;
            const ny = y + dy;
            if (this.bitmap.InRange(nx, ny) && !this.visited.GetPixel(nx, ny)) {
                neighbors.push([nx, ny]);
            }
        }
        return neighbors;
    }

    generate() {
        this.bitmap.Clear(1); // Set all cells as walls
        const stack = [];
        let startX = Math.floor(Math.random() * this.bitmap.width);
        let startY = Math.floor(Math.random() * this.bitmap.height);
        startX &= ~1; // Make sure the start cell is even
        startY &= ~1;
        startX += 1; // Make sure the start cell is not a corner
        startY += 1;
        stack.push([startX, startY]);
        this.visited.SetPixel(startX, startY, 1);
        this.bitmap.SetPixelSafe(startX, startY, 0); // Mark start cell as hall
        while (stack.length > 0) {
            const [x, y] = stack.pop();
            const neighbors = this.getUnvisitedNeighbors(x, y);
            if (neighbors.length > 0) {
                // Choose a random neighbor and remove the wall between them
                const [nx, ny] = neighbors[Math.floor(Math.random() * neighbors.length)];
                this.visited.SetPixel(nx, ny, 1);
                this.bitmap.SetPixelSafe(nx, ny, 0);
                this.bitmap.SetPixelSafe((x + nx) / 2, (y + ny) / 2, 0);
                // Push the current cell and the next cell onto the stack
                stack.push([x, y]);
                stack.push([nx, ny]);
            }
        }
    }
}

// recursive backtracking algorithm
export class MazeGenerator2 {
    constructor(bitmap) {
        this.bitmap = bitmap;
        this.visited = new Array(bitmap.height);
        for (let i = 0; i < bitmap.height; i++) {
            this.visited[i] = new Array(bitmap.width).fill(false);
        }
    }

    getUnvisitedNeighbors(x, y) {
        const neighbors = [];
        const directions = [
            [0, -2],
            [2, 0],
            [0, 2],
            [-2, 0],
        ]; // Up, Right, Down, Left
        for (const [dx, dy] of directions) {
            const nx = x + dx;
            const ny = y + dy;
            if (this.bitmap.InRange(nx, ny) && !this.visited[ny][nx]) {
                neighbors.push([nx, ny]);
            }
        }
        return neighbors;
    }

    visitCell(x, y) {
        this.visited[y][x] = true;
        this.bitmap.SetPixelSafe(x, y, 0); // Mark cell as hall
        const neighbors = this.getUnvisitedNeighbors(x, y);
        // Shuffle the neighbors to ensure a random order
        for (let i = neighbors.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [neighbors[i], neighbors[j]] = [neighbors[j], neighbors[i]];
        }
        // Recursively visit unvisited neighbors
        for (const [nx, ny] of neighbors) {
            if (!this.visited[ny][nx]) {
                this.bitmap.SetPixelSafe((x + nx) / 2, (y + ny) / 2, 0); // Remove wall
                this.visitCell(nx, ny);
            }
        }
    }

    generate() {
        this.bitmap.Clear(1); // Set all cells as walls
        let startX = Math.floor(Math.random() * this.bitmap.width);
        let startY = Math.floor(Math.random() * this.bitmap.height);
        startX &= ~1; // Make sure the start cell is even
        startY &= ~1;
        startX += 1; // Make sure the start cell is not a corner
        startY += 1;
        this.visitCell(startX, startY);
    }
}

// Recursive division method
export class MazeGenerator {
    constructor(bitmap, seed = 123456789) {
        this.bitmap = bitmap;
        this.random = new RandomFast(seed);
    }

    divide(x, y, width, height) {
        if (width <= 2 || height <= 2) {
            // Base case: the region is too small to divide further
            return;
        }

        let divideHorizontally = this.random.RandFloat() < 0.5;
        let sparsity = 0.96; // randomly fill in connections

        if (divideHorizontally) {
            // Horizontal division
            const wallY = y + 1 + 2 * Math.floor(this.random.RandFloat() * ((height - 2) / 2));
            const gapX = x + 2 * Math.floor(this.random.RandFloat() * (width / 2));
            for (let i = x; i < x + width; i++) {
                if (i !== gapX && this.random.RandFloat() < sparsity) {
                    this.bitmap.SetPixelSafe(i, wallY, 1);
                }
            }
            // Recursively divide the top and bottom regions
            this.divide(x, y, width, wallY - y);
            this.divide(x, wallY + 1, width, y + height - wallY - 1);
        } else {
            // Vertical division
            const wallX = x + 1 + 2 * Math.floor(this.random.RandFloat() * ((width - 2) / 2));
            const gapY = y + 2 * Math.floor(this.random.RandFloat() * (height / 2));
            for (let i = y; i < y + height; i++) {
                if (i !== gapY && this.random.RandFloat() < sparsity) {
                    this.bitmap.SetPixelSafe(wallX, i, 1);
                }
            }
            // Recursively divide the left and right regions
            this.divide(x, y, wallX - x, height);
            this.divide(wallX + 1, y, x + width - wallX - 1, height);
        }
    }

    getRandomOpenPosition() {
        let x = Math.floor(this.random.RandFloat() * this.bitmap.width);
        let y = Math.floor(this.random.RandFloat() * this.bitmap.height);
        while (this.bitmap.GetPixel(x, y) === 1) {
            x = Math.floor(this.random.RandFloat() * this.bitmap.width);
            y = Math.floor(this.random.RandFloat() * this.bitmap.height);
        }
        return [x, y];
    }

    generate() {
        this.bitmap.Clear(0); // Set all cells as halls
        this.divide(0, 0, this.bitmap.width, this.bitmap.height);
        return this;
    }
}
