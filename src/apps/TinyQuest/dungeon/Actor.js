export class Actor {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.isDead = false;
        // Additional variables for turn-based roguelike (e.g., health, attack power, etc.)
        this.health = 100;
        this.attackPower = 10;
    }

    // Get the actor's current position
    getPosition() {
        return { x: this.x, y: this.y };
    }

    // Set the actor's position
    setPosition(x, y) {
        this.x = x;
        this.y = y;
    }

    // Check if the actor is dead
    isActorDead() {
        return this.isDead;
    }

    // Set the dead status of the actor
    setDeadStatus(status) {
        this.isDead = status;
    }

    // Move the actor by the specified amount (dx, dy)
    move(dx, dy, maze) {
        const newX = this.x + dx;
        const newY = this.y + dy;
        // Check if the new position is within the maze bounds and not a wall
        if (maze.InRange(newX, newY) && maze.GetPixel(newX, newY) === 0) {
            this.x = newX;
            this.y = newY;
        }
    }

    // Additional methods for turn-based roguelike (e.g., attack, take damage, etc.)
    takeDamage(damage) {
        this.health -= damage;
        if (this.health <= 0) {
            this.isDead = true;
        }
    }

    attack(target) {
        if (target) {
            target.takeDamage(this.attackPower);
        }
    }
}