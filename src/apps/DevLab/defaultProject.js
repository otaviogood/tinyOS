// Welcome to DevLab! Try writing some code:
// You can use print() to display text
// and draw() to create graphics

print("Hello, World! 👋");
print("Let's code something fun!");

// Try changing these values:
let x = 50;      // percent of width (0..100)
let y = 37.5;    // percent of width (0..75)
let size = 20;   // pixels
let color = "blue";

// Draw a circle at screen center
draw.circle(x, y, size, color);

// Draw more shapes along the top edge
for (let i = 0; i < 6; i++) {
    const px = 10 + i * 15; // 10, 25, 40, 55, 70, 85
    draw.circle(px, 10, 8, "red");
}

// Draw some text
draw.text("TINY!", 50, 35, "lime", 72, "center");
