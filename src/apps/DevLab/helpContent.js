// Help content for DevLab
export const helpSections = [
    {
        title: "Drawing Functions",
        examples: [
            {
                name: "Circle",
                code: "draw.circle(x, y, radius, color);",
                description: "Draw a filled circle at (x,y)"
            },
            {
                name: "Rectangle", 
                code: "draw.rect(x, y, width, height, color);",
                description: "Draw a filled rectangle"
            },
            {
                name: "Line",
                code: "draw.line(x1, y1, x2, y2, color, width);",
                description: "Draw a line from (x1,y1) to (x2,y2)"
            },
            {
                name: "Clear",
                code: "draw.clear();",
                description: "Clear the canvas"
            }
        ]
    },
    {
        title: "Output Functions",
        examples: [
            {
                name: "Print",
                code: "print('Hello, World!');",
                description: "Display text in the output"
            }
        ]
    },
    {
        title: "Example Programs",
        examples: [
            {
                name: "Rainbow",
                code: `// Draw a rainbow!
let colors = ['red', 'orange', 'yellow', 'green', 'blue', 'purple'];
for (let i = 0; i < colors.length; i++) {
    draw.circle(300, 200, 150 - i * 20, colors[i]);
}`,
                description: "Draw colorful circles"
            },
            {
                name: "Pattern",
                code: `// Create a pattern
for (let x = 0; x < 10; x++) {
    for (let y = 0; y < 10; y++) {
        if ((x + y) % 2 === 0) {
            draw.rect(x * 60, y * 40, 50, 30, 'blue');
        } else {
            draw.circle(x * 60 + 25, y * 40 + 15, 15, 'red');
        }
    }
}`,
                description: "Alternating shapes pattern"
            }
        ]
    }
]; 