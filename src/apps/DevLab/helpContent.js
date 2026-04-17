// Help content for DevLab
export const helpSections = [
    {
        title: "Drawing Functions",
        examples: [
            {
                name: "Circle",
                code: "draw.circle(x, y, radius, color);",
                description: "Draw a filled circle at (x,y). x:0–100, y:0–75 (percent of width)."
            },
            {
                name: "Rectangle", 
                code: "draw.rect(x, y, width, height, color);",
                description: "Draw a filled rectangle. x,y use percent-of-width; sizes are pixels."
            },
            {
                name: "Line",
                code: "draw.line(x1, y1, x2, y2, color, width);",
                description: "Draw a line from (x1,y1) to (x2,y2). x:0–100, y:0–75."
            },
            {
                name: "Text",
                code: "draw.text(text, x, y, color, size, align);",
                description: "Draw text at (x,y). align can be 'left', 'center', or 'right'."
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
                name: "setup + loop (animated line)",
                code: `function setup() {
    // initialize state
}

let x = 0;
function loop() {
    draw.clear();
    x = (x + 1) % 100;       // x in percent of width (0..100)
    // y in percent of width (0..75 covers full height)
    draw.line(0, 10, x, 10, 'black', 1);
    draw.circle(x, 10, 3, 'red');
}`,
                description: "Processing-style setup() and loop() using namespaced draw.* API"
            },
            {
                name: "Rainbow",
                code: `// Draw a rainbow using percent-based coordinates
let colors = ['red', 'orange', 'yellow', 'green', 'blue', 'purple'];
// Center at (50, 37.5): middle of a 4:3 area
for (let i = 0; i < colors.length; i++) {
    // Radii are pixels; keep them modest to stay on screen
    draw.circle(50, 37.5, 24 - i * 4, colors[i]);
}`,
                description: "Concentric circles centered on screen (x:0–100, y:0–75)"
            },
            {
                name: "Pattern",
                code: `// Checker pattern across the screen using percent units
for (let xi = 0; xi < 10; xi++) {
    for (let yi = 0; yi < 10; yi++) {
        // Grid cell centers: x = 5, 15, ..., 95; y = 3, 10.5, ..., 73.5
        const x = xi * 10 + 5;       // percent of width (0..100)
        const y = yi * 7.5 + 3;      // percent of width (0..75)
        if ((xi + yi) % 2 === 0) {
            draw.rect(x, y, 6, 6, 'blue'); // sizes in pixels
        } else {
            draw.circle(x, y, 3, 'red');   // radius in pixels
        }
    }
}`,
                description: "Alternating rectangles and circles within a 10×10 grid"
            },
            {
                name: "Text labels",
                code: `draw.clear();
draw.text("Hello!", 10, 10, "red", 24, "left");
draw.text("Centered", 50, 37.5, "blue", 28, "center");
draw.text("Right side", 95, 65, "black", 18, "right");`,
                description: "Draw text with different alignment"
            }
        ]
    }
]; 