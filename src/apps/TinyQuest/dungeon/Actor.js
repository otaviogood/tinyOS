export class Actor {
    static statsCSV = `monsterType	img	actorMode	health	maxHealth	mana	maxMana	attackPower	experience	level	element	readableName	about
hero	heroic_knight_trans.webp	0	8	8	1	1	1	0			Hero	
greenSlime	green_slime_trans.webp	0	1	1	0	0	1	5	0	e_water	Green Slime	Squash these things!
pumpkin	pumpkin.webp	0	2	2	0	0	1	10	0	e_earth	Vampumpkin	Vampumpkin's attack will steal your life.
tweeger	tweeger_trans.webp	0	4	4	0	0	1	15	1	e_fire	Tweeger	A Baflooming Tweeger is a magical tweegy beegy.
hairMonster	hairMonster.webp	0	2	2	0	0	2	20	2	e_air	Hairbo	Don't be fooled by the cuteness, Hairbo will get you.
grouch	grouch.webp	0	7	7	0	0	1	25	3	e_earth	Grouch	The grouch is the worst.
pizzaMonster	pizzaMonster.webp	0	2	2	0	0	4	30	4	e_fire	Pizzattack	This pizza is hot like fire! No frozen pizza here.
artifactFreeze	artifactFreeze.webp	1	0	0	0	0	0	10	0	e_water	Freeze Artifact	This gives you the freeze spell. Use it in battles!
manaPotion	manaPotion.webp	2	0	0	1	0	0	0	0		Mana Potion	This fills your mana up by 1 point.`;
    static statsLookup = null;
    constructor(x, y, monsterType) {
        if (Actor.statsLookup === null) {
            // Parse the tab delimited statsCSV CSV string to be a dictionary with the first column as the key.
            Actor.statsLookup = {};
            const lines = Actor.statsCSV.split("\n");
            const keys = lines[0].split("\t");
            // get rid of extra tabs
            for (let i = 0; i < keys.length; i++) keys[i] = keys[i].trim();
            // console.log(keys);

            for (let i = 1; i < lines.length; i++) {
                const values = lines[i].split("\t");
                // get rid of extra tabs
                for (let j = 0; j < values.length; j++) values[j] = values[j].trim();
                const stats = {};
                for (let j = 0; j < keys.length; j++) {
                    if (values[j] === "") continue;
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
        this.drop = null;
        this.dropChance = 0.5;
        // Set member variables based on monsterType. lookup stats from Actor.statsLookup.
        // Dynamically set only the member variables that are defined in statsLookup.
        const stats = Actor.statsLookup[monsterType];
        for (const key in stats) {
            if (stats.hasOwnProperty(key)) this[key] = stats[key];
        }

        // Additional variables for turn-based roguelike (e.g., health, attack power, etc.)
        if (monsterType === "hero") {
            this.img = "heroic_knight_trans.webp";
            this.health = 8;
            this.maxHealth = 8;
            this.mana = 1;
            this.maxMana = 1;
            this.attackPower = 1;
            this.experience = 0;
            this.XPHealthDelta = 16;
            this.XPMaxHealthDelta = 256;
            this.lastXPHealth = 0;
            this.lastXPMaxHealth = 0;
            this.attackingTrigger = 0; // For animation triggers
        } else if (monsterType === "stairs") {
            this.img = "stairs01.jpg";
            this.stairs = true;
            this.health = 1;
            this.maxHealth = 1;
            this.mana = 0;
            this.maxMana = 0;
            this.attackPower = 1;
            this.experience = 1;
        }

        // Initialize frozen state
        this.frozen = 0; // Number of turns the actor remains frozen
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

    addMaxHealth(dMaxHealth) {
        this.maxHealth += dMaxHealth;
        if (this.health > this.maxHealth) this.health = this.maxHealth;
    }

    addMana(dm) {
        this.mana += dm;
        if (this.mana > this.maxMana) this.mana = this.maxMana;
    }

    addMaxMana(dMaxMana) {
        this.maxMana += dMaxMana;
        if (this.mana > this.maxMana) this.mana = this.maxMana;
    }

    addXP(dXP) {
        this.experience += dXP;
        if (this.experience >= this.lastXPMaxHealth + this.XPMaxHealthDelta) {
            this.addMaxHealth(1);
            this.lastXPMaxHealth = this.experience;
        }
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

    // Add a method to freeze the actor
    freeze(duration) {
        this.frozen = duration;
    }

    // Check if the actor is frozen
    isFrozen() {
        return this.frozen > 0;
    }

    // Decrease frozen counter after a turn
    decreaseFrozen() {
        if (this.frozen > 0) {
            this.frozen--;
        }
    }

    pickup(character) {
        if (character.actorMode === 1) {
            // pick up item
            this.addXP(character.experience);
            character.setDeadStatus(true);
        } else if (character.actorMode === 2) {
            // pick up mana potion
            this.addMana(1);
            character.setDeadStatus(true);
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