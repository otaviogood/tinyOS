export class Actor {
    static statsCSV = 
`monsterType	img	health	maxHealth	mana	maxMana	attackPower	experience	level	element
hero	heroic_knight_trans.webp	8	8	1	1	1	0		
greenSlime	green_slime_trans.webp	1	1	0	0	1	1	0	e_water
pumpkin	pumpkin.webp	2	2	0	0	1	2	0	e_earth
tweeger	tweeger_trans.webp	4	4	0	0	1	3	1	e_fire
hairMonster	hairMonster.webp	2	2	0	0	2	4	2	e_air
grouch	grouch.webp	7	7	0	0	1	6	3	e_earth`
    static statsLookup = null;
    constructor(x, y, monsterType) {
        if (Actor.statsLookup === null) {
            // Parse the tab delimited statsCSV CSV string to be a dictionary with the first column as the key.
            Actor.statsLookup = {};
            const lines = Actor.statsCSV.split('\n');
            const keys = lines[0].split('\t');
            // get rid of extra tabs
            for (let i = 0; i < keys.length; i++) keys[i] = keys[i].trim();
            // console.log(keys);

            for (let i = 1; i < lines.length; i++) {
                const values = lines[i].split('\t');
                // get rid of extra tabs
                for (let j = 0; j < values.length; j++) values[j] = values[j].trim();
                const stats = {};
                for (let j = 0; j < keys.length; j++) {
                    if (values[j] === '') continue;
                    // console.log(keys[j], values[j]);
                    // If it can be converted to a number, do so.
                    if (!isNaN(values[j])) values[j] = Number(values[j]);
                    stats[keys[j]] = values[j];
                }
                Actor.statsLookup[values[0]] = stats;
            }

        }
        // console.log(Actor.statsLookup);
        this.x = x;
        this.y = y;
        this.monsterType = monsterType;
        this.isDead = false;
        // Set member variables based on monsterType. lookup stats from Actor.statsLookup.
        // Dynamically set only the member variables that are defined in statsLookup.
        const stats = Actor.statsLookup[monsterType];
        for (const key in stats) {
            if (stats.hasOwnProperty(key)) this[key] = stats[key];
        }

        // Additional variables for turn-based roguelike (e.g., health, attack power, etc.)
        if (monsterType === 'hero') {
            this.img = "heroic_knight_trans.webp";
            this.health = 8;
            this.maxHealth = 8;
            this.mana = 1;
            this.maxMana = 1;
            this.attackPower = 1;
            this.experience = 0;
            this.XPHealthDelta = 10;
            this.lastXPHealth = 0;
            this.attackingTrigger = 0; // For animation triggers
        // } else if (monsterType === 'greenSlime') {
        //     this.img = "pumpkin.png";
        //     this.health = 1;
        //     this.maxHealth = 1;
        //     this.mana = 0;
        //     this.maxMana = 0;
        //     this.attackPower = 1;
        //     this.experience = 1;
        // } else if (monsterType === 'tweeger') {
        //     this.img = "tweeger_trans.webp";
        //     this.health = 4;
        //     this.maxHealth = 4;
        //     this.mana = 0;
        //     this.maxMana = 0;
        //     this.attackPower = 1;
        //     this.experience = 1;
        // } else if (monsterType === 'hairMonster') {
        //     this.img = "hairMonster.png";
        //     this.health = 2;
        //     this.maxHealth = 2;
        //     this.mana = 0;
        //     this.maxMana = 0;
        //     this.attackPower = 2;
        //     this.experience = 2;
        // } else if (monsterType === 'grouch') {
        //     this.img = "grouch.png";
        //     this.health = 7;
        //     this.maxHealth = 7;
        //     this.mana = 0;
        //     this.maxMana = 0;
        //     this.attackPower = 1;
        //     this.experience = 6;
        } else if (monsterType === 'stairs') {
            this.img = "stairs01.jpg";
            this.stairs = true;
            this.health = 1;
            this.maxHealth = 1;
            this.mana = 0;
            this.maxMana = 0;
            this.attackPower = 1;
            this.experience = 1;
        }
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

    addHealth(dh) {
        this.health += dh;
        if (this.health > this.maxHealth) this.health = this.maxHealth;
    }

    addXP(dXP) {
        this.experience += dXP;
        if (this.experience >= this.lastXPHealth + this.XPHealthDelta) {
            this.addHealth(1);
            this.lastXPHealth = this.experience;
        }
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



/*
Fire Mage:
Strengths: Strong against Wood and Earth classes due to fire's ability to burn and disintegrate these elements. Specializes in high damage output and area control.
Weaknesses: Weak against Water and Air classes. Water can extinguish fire, and Air can disperse it, reducing its effectiveness.

Water Priest:
Strengths: Strong against Fire and Earth classes. Water can extinguish fire and erode or soften earth. Excelling in healing and defensive magic.
Weaknesses: Weak against Wood and Air classes. Wood can absorb water, and Air's unpredictability can disrupt water's flow.

Wood Ranger:
Strengths: Strong against Earth and Water classes. Wood can take root in Earth, drawing strength, and it can absorb water for growth. Skilled in stealth and ranged attacks.
Weaknesses: Weak against Fire and Air classes. Fire burns wood, and Air can uproot or dry it out.

Earth Knight:
Strengths: Strong against Air and Fire classes. Earth can smother fire and is generally impervious to air's effects. Specializes in defense and high physical strength.
Weaknesses: Weak against Water and Wood classes. Water can erode earth, and Wood can break through it with roots.

Air Assassin:
Strengths: Strong against Wood and Water classes. Air can dry out and scatter Wood, and it can create waves or disrupt Water. Known for high agility and evasion.
Weaknesses: Weak against Earth and Fire classes. Earth is largely unaffected by Air, and Fire can consume oxygen, weakening Air's influence.

*/