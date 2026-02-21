class EnemyServer {
    constructor(enemyData) {
        this.id = enemyData.id;
        this.type = enemyData.enemy;
        this.level = enemyData.level || 1;

        this.position = { x: enemyData.posX, y: enemyData.posY };

        // Nei dungeon parte disabilitato
        this.enabled = enemyData.dungeon ? false : true;

        this.target = null;
        this.stopDistance = 0.7;
        this.speed = 3;
    }

    update(deltaTime) {
        if (!this.enabled || !this.target) return;

        const dx = this.target.x - this.position.x;
        const dy = this.target.y - this.position.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance <= this.stopDistance) return;

        const moveX = (dx / distance) * this.speed * deltaTime;
        const moveY = (dy / distance) * this.speed * deltaTime;

        this.position.x += moveX;
        this.position.y += moveY;
    }

    setTarget(playerID, position) {
        this.target = { id: playerID, x: position.x, y: position.y };
    }

    enable() {
        this.enabled = true;
    }

    disable() {
        this.enabled = false;
        this.target = null;
    }
}

module.exports = EnemyServer;

