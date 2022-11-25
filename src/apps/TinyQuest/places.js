export class Town {
    constructor(x, y, name, path, options) {
        this.x = x;
        this.y = y;
        this.name = name;
        this.activated = false;
        this.unique = 0;
        if (path) this.path = path;
        else this.path = "/";
        this.options = options || null;
    }
}

export class Road {
    constructor(townNameA, townNameB, allTowns) {
        let townA = allTowns.find((t) => t.name === townNameA);
        let townB = allTowns.find((t) => t.name === townNameB);
        this.xA = townA.x;
        this.yA = townA.y;
        this.xB = townB.x;
        this.yB = townB.y;
        this.midX = (this.xA + this.xB) * 0.5;
        this.midY = (this.yA + this.yB) * 0.5;
        let dx = this.xB - this.xA;
        let dy = this.yB - this.yA;
        this.angle = Math.atan2(dy, dx);
        this.dist = Math.sqrt(dx * dx + dy * dy);
    }
}
