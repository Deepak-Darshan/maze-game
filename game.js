const canvas = document.getElementById("gameCanvas");
if (!canvas) {
    console.error("Canvas element not found! Make sure the HTML has a canvas with id='gameCanvas'");
}
const ctx = canvas ? canvas.getContext("2d") : null;

const TILE_SIZE = 30;
const N = 21;

// Tile types
const FLOOR = 0;
const WALL = 1;
const SAFE = 2;

// Power-up types
const POWERUP_SPEED = 'speed';

// Game state
const game = {
    maze: [],
    player: { x: 1, y: 1 },
    monster: null,
    keys: [],
    keysCollected: 0,
    exit: { x: N-2, y: N-2 },
    safeZones: [],
    powerups: [],
    gameOver: false,
    won: false,
    deaths: 0,
    startTime: Date.now(),
    endTime: null,
    lastMoveTime: 0,
    moveDelay: 120,
    playerTrail: [],
    invulnFrames: 0,
    monsterSpeedMultiplier: 1.0,
    lastSpeedIncreaseTime: Date.now(),
    activeEffects: [],
    spikes: [],
    bombPickups: [],
    hasBomb: false,
    placedBomb: null, // {x, y, placedAt}
    explosion: null, // {x, y, startTime, tiles} - for explosion animation
    breakingWalls: [], // [{x, y, startTime}] - for wall breaking animation
    monsterDetectionRadius: 8,
    monsterAlertLevel: 0,
    frameCount: 0
};

const input = { keys: {}, lastBombPress: false };

// Generate maze
function generateMaze() {
    const maze = Array.from({length: N}, () => Array(N).fill(WALL));

    function carve(x, y) {
        maze[y][x] = FLOOR;
        const dirs = [[0,-2],[2,0],[0,2],[-2,0]].sort(() => Math.random() - 0.5);
        for (const [dx, dy] of dirs) {
            const nx = x + dx, ny = y + dy;
            if (nx > 0 && nx < N-1 && ny > 0 && ny < N-1 && maze[ny][nx] === WALL) {
                maze[y + dy/2][x + dx/2] = FLOOR;
                carve(nx, ny);
            }
        }
    }

    carve(1, 1);
    maze[N-2][N-2] = FLOOR;

    // Widen corridors
    for (let i = 0; i < 35; i++) {
        const x = Math.floor(Math.random() * (N-2)) + 1;
        const y = Math.floor(Math.random() * (N-2)) + 1;
        if (maze[y][x] === WALL) {
            let floorNeighbors = 0;
            [[0,1],[1,0],[0,-1],[-1,0]].forEach(([dx,dy]) => {
                if (maze[y+dy]?.[x+dx] === FLOOR) floorNeighbors++;
            });
            if (floorNeighbors >= 2) maze[y][x] = FLOOR;
        }
    }

    return maze;
}

// Place game elements
function placeElements() {
    const floors = [];
    for (let y = 1; y < N-1; y++) {
        for (let x = 1; x < N-1; x++) {
            if (game.maze[y][x] === FLOOR) {
                floors.push({x, y});
            }
        }
    }

    // Place 3-4 safe zones (limited use)
    game.safeZones = [];
    for (let i = 0; i < 4; i++) {
        const center = floors[Math.floor(Math.random() * floors.length)];
        if (center.x < 6 && center.y < 6) continue;
        
        const zone = {
            x: center.x,
            y: center.y,
            used: false,
            usedAt: null,
            magnetStrength: 0
        };
        
        game.safeZones.push(zone);
        game.maze[center.y][center.x] = SAFE;
        
        // Try to add adjacent tiles
        for (const [dx, dy] of [[1,0], [0,1], [1,1]]) {
            const sx = center.x + dx, sy = center.y + dy;
            if (sx < N && sy < N && game.maze[sy][sx] === FLOOR) {
                const adjacentZone = {
                    x: sx,
                    y: sy,
                    used: false,
                    usedAt: null,
                    magnetStrength: 0
                };
                game.safeZones.push(adjacentZone);
                game.maze[sy][sx] = SAFE;
            }
        }
    }

    // Place 3 keys
    game.keys = [];
    for (let i = 0; i < 3; i++) {
        let pos;
        let attempts = 0;
        do {
            pos = floors[Math.floor(Math.random() * floors.length)];
            attempts++;
            if (attempts > 100) break;
        } while (
            game.keys.some(k => Math.abs(k.x - pos.x) + Math.abs(k.y - pos.y) < 5) ||
            (pos.x < 6 && pos.y < 6) ||
            (pos.x > N-6 && pos.y > N-6) ||
            game.safeZones.some(sz => sz.x === pos.x && sz.y === pos.y)
        );
        
        game.keys.push({x: pos.x, y: pos.y, collected: false});
    }

    // Place power-ups (2 speed powerups)
    game.powerups = [];
    
    for (let i = 0; i < 2; i++) {
        const type = POWERUP_SPEED;
        let pos;
        let attempts = 0;
        do {
            pos = floors[Math.floor(Math.random() * floors.length)];
            attempts++;
            if (attempts > 100) break;
        } while (
            game.powerups.some(p => p.x === pos.x && p.y === pos.y) ||
            game.keys.some(k => k.x === pos.x && k.y === pos.y) ||
            (pos.x < 6 && pos.y < 6) ||
            game.safeZones.some(sz => sz.x === pos.x && sz.y === pos.y)
        );
        
        game.powerups.push({x: pos.x, y: pos.y, type, collected: false});
    }

    // Place spikes (3-4 groups)
    game.spikes = [];
    for (let i = 0; i < 4; i++) {
        const center = floors[Math.floor(Math.random() * floors.length)];
        if (center.x < 6 && center.y < 6) continue;
        
        for (const [dx, dy] of [[0,0], [1,0], [0,1]]) {
            const sx = center.x + dx, sy = center.y + dy;
            if (sx < N-1 && sy < N-1 && game.maze[sy][sx] === FLOOR) {
                game.spikes.push({
                    x: sx,
                    y: sy,
                    active: Math.random() > 0.5,
                    toggleTime: Date.now() + Math.random() * 3000
                });
            }
        }
    }

    // Place bomb pickups (2 bombs total)
    game.bombPickups = [];
    for (let i = 0; i < 2; i++) {
        let pos;
        let attempts = 0;
        do {
            pos = floors[Math.floor(Math.random() * floors.length)];
            attempts++;
            if (attempts > 100) break;
        } while (
            game.bombPickups.some(b => b.x === pos.x && b.y === pos.y) ||
            game.keys.some(k => k.x === pos.x && k.y === pos.y) ||
            game.powerups.some(p => p.x === pos.x && p.y === pos.y) ||
            (pos.x < 6 && pos.y < 6) ||
            (pos.x === game.exit.x && pos.y === game.exit.y) ||
            game.safeZones.some(sz => sz.x === pos.x && sz.y === pos.y)
        );
        
        if (pos) {
            game.bombPickups.push({x: pos.x, y: pos.y, collected: false});
        }
    }
}

// Place monster
function placeMonster() {
    const floors = [];
    for (let y = 1; y < N-1; y++) {
        for (let x = 1; x < N-1; x++) {
            if (game.maze[y][x] === FLOOR) {
                const dist = Math.abs(x - 1) + Math.abs(y - 1);
                if (dist >= 12) {
                    floors.push({x, y});
                }
            }
        }
    }

    const pos = floors[Math.floor(Math.random() * floors.length)] || {x: N-3, y: 1};
    game.monster = {
        x: pos.x,
        y: pos.y,
        cooldown: 0,
        baseSpeed: 10
    };
}

// Store initial state for reset
let initialMaze = null;
let initialSafeZones = null;
let initialBombPickups = null;
let initialKeys = null;
let initialPowerups = null;
let initialSpikes = null;
let initialExit = null;
let initialPlayerPos = null;
let initialMonsterPos = null;

// Initialize game
function init() {
    game.maze = generateMaze();
    game.player = {x: 1, y: 1};
    game.keysCollected = 0;
    game.gameOver = false;
    game.won = false;
    game.deaths = 0;
    game.startTime = Date.now();
    game.endTime = null;
    game.invulnFrames = 0;
    game.monsterSpeedMultiplier = 1.0;
    game.lastSpeedIncreaseTime = Date.now();
    game.activeEffects = [];
    game.monsterAlertLevel = 0;
    game.frameCount = 0;
    game.playerTrail = [];
    game.hasBomb = false;
    game.placedBomb = null;
    game.explosion = null;
    game.breakingWalls = [];
    
    placeElements();
    placeMonster();
    
    // Save initial state for reset
    initialMaze = game.maze.map(row => [...row]);
    initialSafeZones = JSON.parse(JSON.stringify(game.safeZones));
    initialBombPickups = JSON.parse(JSON.stringify(game.bombPickups));
    initialKeys = JSON.parse(JSON.stringify(game.keys));
    initialPowerups = JSON.parse(JSON.stringify(game.powerups));
    initialSpikes = JSON.parse(JSON.stringify(game.spikes));
    initialExit = {...game.exit};
    initialPlayerPos = {...game.player};
    initialMonsterPos = {...game.monster};
    
    updateHUD();
}

// Reset current level to initial state
function resetLevel() {
    if (!initialMaze) return;
    
    // Restore maze
    game.maze = initialMaze.map(row => [...row]);
    
    // Restore safe zones
    game.safeZones = JSON.parse(JSON.stringify(initialSafeZones));
    // Reset safe zone usage
    game.safeZones.forEach(zone => {
        zone.used = false;
        zone.usedAt = null;
        zone.magnetStrength = 0;
    });
    
    // Restore bomb pickups
    game.bombPickups = JSON.parse(JSON.stringify(initialBombPickups));
    game.bombPickups.forEach(bomb => {
        bomb.collected = false;
    });
    
    // Restore keys
    game.keys = JSON.parse(JSON.stringify(initialKeys));
    game.keys.forEach(key => {
        key.collected = false;
    });
    
    // Restore powerups
    game.powerups = JSON.parse(JSON.stringify(initialPowerups));
    game.powerups.forEach(powerup => {
        powerup.collected = false;
    });
    
    // Restore spikes
    game.spikes = JSON.parse(JSON.stringify(initialSpikes));
    
    // Restore exit
    game.exit = {...initialExit};
    
    // Reset player
    game.player = {...initialPlayerPos};
    game.keysCollected = 0;
    game.playerTrail = [];
    game.hasBomb = false;
    game.placedBomb = null;
    game.explosion = null;
    game.breakingWalls = [];
    
    // Reset monster
    game.monster = {...initialMonsterPos};
    game.monster.cooldown = 0;
    
    // Reset game state
    game.gameOver = false;
    game.won = false;
    game.startTime = Date.now();
    game.endTime = null;
    game.invulnFrames = 0;
    game.monsterSpeedMultiplier = 1.0;
    game.lastSpeedIncreaseTime = Date.now();
    game.activeEffects = [];
    game.monsterAlertLevel = 0;
    game.frameCount = 0;
    
    updateHUD();
}

// Skip to new level
function skipLevel() {
    init();
}

// Check if walkable
function isWalkable(x, y, isMonster = false) {
    if (x < 0 || x >= N || y < 0 || y >= N) return false;
    const tile = game.maze[y][x];
    if (tile === WALL) return false;
    
    if (isMonster && tile === SAFE) {
        const zone = game.safeZones.find(z => z.x === x && z.y === y);
        if (zone && !zone.used) return false;
    }
    
    return true;
}

// BFS pathfinding
function findPath(from, to, isMonster = false) {
    const queue = [{...from, path: []}];
    const visited = Array.from({length: N}, () => Array(N).fill(false));
    visited[from.y][from.x] = true;

    while (queue.length > 0) {
        const current = queue.shift();
        
        if (current.x === to.x && current.y === to.y) {
            return current.path;
        }

        for (const [dx, dy] of [[0,-1],[1,0],[0,1],[-1,0]]) {
            const nx = current.x + dx, ny = current.y + dy;
            if (isWalkable(nx, ny, isMonster) && !visited[ny][nx]) {
                visited[ny][nx] = true;
                queue.push({
                    x: nx,
                    y: ny,
                    path: [...current.path, {x: nx, y: ny}]
                });
            }
        }
    }
    return null;
}

// Update monster AI
function updateMonster() {
    if (!game.monster || game.gameOver || game.won) return;

    // Increase speed over time (every 15 seconds, +10% speed, max 2x)
    const timeSinceSpeedIncrease = Date.now() - game.lastSpeedIncreaseTime;
    if (timeSinceSpeedIncrease > 15000) {
        game.monsterSpeedMultiplier = Math.min(2.0, game.monsterSpeedMultiplier + 0.1);
        game.lastSpeedIncreaseTime = Date.now();
        updateHUD();
    }

    // Apply safe zone magnetism
    let magnetTarget = null;
    let strongestMagnet = 0;
    for (const zone of game.safeZones) {
        if (zone.magnetStrength > strongestMagnet) {
            strongestMagnet = zone.magnetStrength;
            magnetTarget = zone;
        }
    }

    // Decay magnet strength over time
    game.safeZones.forEach(zone => {
        if (zone.magnetStrength > 0) {
            zone.magnetStrength = Math.max(0, zone.magnetStrength - 0.5);
        }
    });

    // Calculate detection
    const distToPlayer = Math.abs(game.monster.x - game.player.x) + 
                        Math.abs(game.monster.y - game.player.y);
    
    if (distToPlayer <= game.monsterDetectionRadius) {
        game.monsterAlertLevel = Math.min(100, game.monsterAlertLevel + 5);
    } else {
        game.monsterAlertLevel = Math.max(0, game.monsterAlertLevel - 2);
    }

    // Determine target
    let target = game.player;

    // If strong magnet pull, go there
    if (magnetTarget && strongestMagnet > 30) {
        target = magnetTarget;
    }
    // If alert and have trail, follow oldest trail point
    else if (game.monsterAlertLevel > 30 && game.playerTrail.length > 3) {
        const trailTarget = game.playerTrail[game.playerTrail.length - 1];
        if (trailTarget) target = trailTarget;
    }

    // ALWAYS try to move - never stop
    // Reduce cooldown faster to ensure constant movement
    if (game.monster.cooldown > 0) {
        game.monster.cooldown = Math.max(0, game.monster.cooldown - 2); // Reduce by 2 each frame for faster movement
    }

    // Move towards target - always attempt movement
    const path = findPath(game.monster, target, true);
    if (path && path.length > 0 && game.monster.cooldown <= 0) {
        const step = path[0];
        game.monster.x = step.x;
        game.monster.y = step.y;
        
        const speedMod = game.monsterSpeedMultiplier;
        game.monster.cooldown = Math.max(1, Math.floor(game.monster.baseSpeed / speedMod));
    } else if (game.monster.cooldown <= 0) {
        // If pathfinding fails, try direct movement as fallback - NEVER stop
        const dx = target.x - game.monster.x;
        const dy = target.y - game.monster.y;
        
        // Try to move in the direction of the target
        if (Math.abs(dx) > Math.abs(dy)) {
            // Move horizontally
            const moveX = dx > 0 ? 1 : -1;
            if (isWalkable(game.monster.x + moveX, game.monster.y, true)) {
                game.monster.x += moveX;
            } else if (isWalkable(game.monster.x, game.monster.y + (dy > 0 ? 1 : -1), true)) {
                // Try vertical if horizontal fails
                game.monster.y += (dy > 0 ? 1 : -1);
            }
        } else {
            // Move vertically
            const moveY = dy > 0 ? 1 : -1;
            if (isWalkable(game.monster.x, game.monster.y + moveY, true)) {
                game.monster.y += moveY;
            } else if (isWalkable(game.monster.x + (dx > 0 ? 1 : -1), game.monster.y, true)) {
                // Try horizontal if vertical fails
                game.monster.x += (dx > 0 ? 1 : -1);
            }
        }
        
        const speedMod = game.monsterSpeedMultiplier;
        game.monster.cooldown = Math.max(1, Math.floor(game.monster.baseSpeed / speedMod));
    }
}

// Activate powerup
function activatePowerup(type) {
    const now = Date.now();
    
    if (type === POWERUP_SPEED) {
        game.activeEffects = game.activeEffects.filter(e => e.type !== POWERUP_SPEED);
        game.activeEffects.push({
            type: POWERUP_SPEED,
            duration: 5000,
            startTime: now
        });
    }
    
    updateEffectsDisplay();
}

// Handle player movement
function movePlayer(dx, dy) {
    const now = Date.now();
    if (now - game.lastMoveTime < game.moveDelay) return;

    const newX = game.player.x + dx;
    const newY = game.player.y + dy;

    if (!isWalkable(newX, newY, false)) return;

    // Check for active spikes
    const spike = game.spikes.find(s => s.x === newX && s.y === newY && s.active);
    if (spike) {
        game.deaths++;
        updateHUD();
        respawnPlayer();
        return;
    }

    // Apply speed boost if active
    const speedBoost = game.activeEffects.find(e => e.type === POWERUP_SPEED);
    if (speedBoost) {
        game.moveDelay = 80;
    } else {
        game.moveDelay = 120;
    }

    game.player.x = newX;
    game.player.y = newY;
    game.lastMoveTime = now;

    // Add to trail
    game.playerTrail.unshift({x: newX, y: newY});
    if (game.playerTrail.length > 30) game.playerTrail.pop();

    // Check safe zone entry
    const safeZone = game.safeZones.find(z => z.x === newX && z.y === newY && !z.used);
    if (safeZone) {
        safeZone.used = true;
        safeZone.usedAt = Date.now();
        safeZone.magnetStrength = 80;
        game.invulnFrames = 180;
    }

    // Collect bomb pickups
    const bombPickup = game.bombPickups.find(b => b.x === newX && b.y === newY && !b.collected);
    if (bombPickup && !game.hasBomb) {
        bombPickup.collected = true;
        game.hasBomb = true;
    }

    // Collect keys
    const key = game.keys.find(k => !k.collected && k.x === newX && k.y === newY);
    if (key) {
        key.collected = true;
        game.keysCollected++;
        updateHUD();
    }

    // Collect powerups
    const powerup = game.powerups.find(p => !p.collected && p.x === newX && p.y === newY);
    if (powerup) {
        powerup.collected = true;
        activatePowerup(powerup.type);
    }

    // Check win
    if (newX === game.exit.x && newY === game.exit.y && game.keysCollected === 3) {
        game.won = true;
        game.endTime = Date.now();
    }

    checkCollision();
}

// Place bomb on current tile
function placeBomb() {
    if (!game.hasBomb || game.placedBomb) return; // Can only place one bomb at a time
    
    const x = game.player.x;
    const y = game.player.y;
    
    // Can't place on exit, safe zone, or spike
    if (x === game.exit.x && y === game.exit.y) return;
    if (game.safeZones.some(sz => sz.x === x && sz.y === y)) return;
    if (game.spikes.some(s => s.x === x && s.y === y)) return;
    if (x === game.monster.x && y === game.monster.y) return;
    
    game.placedBomb = {
        x: x,
        y: y,
        placedAt: Date.now()
    };
    game.hasBomb = false;
    
    // Explode after 1 second
    setTimeout(() => {
        explodeBomb();
    }, 1000);
}

// Explode bomb - breaks walls in adjacent and diagonal tiles
function explodeBomb() {
    if (!game.placedBomb) return;
    
    const x = game.placedBomb.x;
    const y = game.placedBomb.y;
    
    // Explosion radius: adjacent and diagonal (8 tiles total)
    const explosionTiles = [
        {dx: -1, dy: -1}, {dx: 0, dy: -1}, {dx: 1, dy: -1},
        {dx: -1, dy: 0},                    {dx: 1, dy: 0},
        {dx: -1, dy: 1},  {dx: 0, dy: 1},  {dx: 1, dy: 1}
    ];
    
    // Start explosion animation
    game.explosion = {
        x: x,
        y: y,
        startTime: Date.now(),
        tiles: explosionTiles
    };
    
    // Remove bomb
    game.placedBomb = null;
    
    // After explosion animation (300ms), break walls
    setTimeout(() => {
        if (!game.explosion) return;
        
        const breakTiles = [];
        for (const {dx, dy} of game.explosion.tiles) {
            const tx = game.explosion.x + dx;
            const ty = game.explosion.y + dy;
            
            // Check bounds
            if (tx < 1 || tx >= N-1 || ty < 1 || ty >= N-1) continue;
            
            // Can't break: exit, safe zones, spikes, monster position
            if (tx === game.exit.x && ty === game.exit.y) continue;
            if (game.safeZones.some(sz => sz.x === tx && sz.y === ty)) continue;
            if (game.spikes.some(s => s.x === tx && s.y === ty)) continue;
            if (tx === game.monster.x && ty === game.monster.y) continue;
            
            // Break wall if it's a wall
            if (game.maze[ty][tx] === WALL) {
                game.maze[ty][tx] = FLOOR;
                breakTiles.push({x: tx, y: ty, startTime: Date.now()});
            }
        }
        
        // Add breaking animation for walls
        game.breakingWalls = breakTiles;
        
        // Clear explosion after animation
        setTimeout(() => {
            game.explosion = null;
            game.breakingWalls = [];
        }, 500);
    }, 300);
}

// Update active effects
function updateEffects() {
    const now = Date.now();
    game.activeEffects = game.activeEffects.filter(effect => {
        return (now - effect.startTime) < effect.duration;
    });

    // Update spike toggles
    game.spikes.forEach(spike => {
        if (now >= spike.toggleTime) {
            spike.active = !spike.active;
            spike.toggleTime = now + 2000 + Math.random() * 2000;
        }
    });

    // Decay safe zone protection
    if (game.invulnFrames > 0) {
        game.invulnFrames--;
    }

    // Remove old safe zones
    game.safeZones.forEach(zone => {
        if (zone.used && zone.usedAt && now - zone.usedAt > 3000) {
            game.maze[zone.y][zone.x] = FLOOR;
        }
    });
    game.safeZones = game.safeZones.filter(zone => {
        if (!zone.used) return true;
        return now - zone.usedAt < 3000;
    });
    
    updateEffectsDisplay();
}

// Check collision
function checkCollision() {
    if (game.invulnFrames > 0) return;
    
    if (game.player.x === game.monster.x && game.player.y === game.monster.y) {
        game.deaths++;
        updateHUD();
        respawnPlayer();
    }
}

// Respawn player
function respawnPlayer() {
    game.player.x = 1;
    game.player.y = 1;
    game.invulnFrames = 60;
    game.playerTrail = [];
    game.monsterAlertLevel = 0;
    game.hasBomb = false;
    game.placedBomb = null;
    game.explosion = null;
    game.breakingWalls = [];
    placeMonster();
}

// Update HUD
function updateHUD() {
    document.getElementById('keyCount').textContent = game.keysCollected;
    document.getElementById('deathCount').textContent = game.deaths;
    document.getElementById('monsterSpeed').textContent = game.monsterSpeedMultiplier.toFixed(1);
    
    if (!game.endTime && (game.won || game.gameOver)) {
        game.endTime = Date.now();
    }
    const currentTime = game.endTime || Date.now();
    const elapsed = Math.floor((currentTime - game.startTime) / 1000);
    document.getElementById('timeCount').textContent = elapsed;
}

// Update effects display
function updateEffectsDisplay() {
    const effectsBar = document.getElementById('effectsBar');
    if (!effectsBar) return;
    
    effectsBar.innerHTML = '';
    
    game.activeEffects.forEach(effect => {
        const remaining = Math.ceil((effect.duration - (Date.now() - effect.startTime)) / 1000);
        const effectDiv = document.createElement('div');
        effectDiv.className = 'effect-indicator';
        
        const icons = {
            speed: '⚡'
        };
        
        effectDiv.textContent = `${icons[effect.type]} ${remaining}s`;
        effectsBar.appendChild(effectDiv);
    });
}

// Game loop
function gameLoop() {
    if (!canvas || !ctx) return;
    
    if (!game.gameOver && !game.won) {
        // Handle input
        if (input.keys['ArrowUp'] || input.keys['w'] || input.keys['W']) movePlayer(0, -1);
        if (input.keys['ArrowDown'] || input.keys['s'] || input.keys['S']) movePlayer(0, 1);
        if (input.keys['ArrowLeft'] || input.keys['a'] || input.keys['A']) movePlayer(-1, 0);
        if (input.keys['ArrowRight'] || input.keys['d'] || input.keys['D']) movePlayer(1, 0);
        
        // Place bomb on Space key (only once per press)
        if ((input.keys[' '] || input.keys['Space']) && !input.lastBombPress) {
            try {
                placeBomb();
                input.lastBombPress = true;
            } catch (error) {
                console.error("Error placing bomb:", error);
            }
        }
        
        // Reset bomb press flag when space is released
        if (!input.keys[' '] && !input.keys['Space']) {
            input.lastBombPress = false;
        }

        game.frameCount++;
        if (game.frameCount % 2 === 0) {
            updateMonster();
        }

        updateEffects();
        checkCollision();
        updateHUD();
    }

    draw();
    requestAnimationFrame(gameLoop);
}

// Draw game
function draw() {
    if (!canvas || !ctx) return;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw maze
    for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
            const tile = game.maze[y][x];
            const px = x * TILE_SIZE;
            const py = y * TILE_SIZE;

            if (tile === WALL) {
                ctx.fillStyle = "#2d3561";
                ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
                ctx.strokeStyle = "#1a1f3a";
                ctx.strokeRect(px, py, TILE_SIZE, TILE_SIZE);
            } else if (tile === SAFE) {
                const zone = game.safeZones.find(z => z.x === x && z.y === y);
                if (zone) {
                    if (!zone.used) {
                        ctx.fillStyle = "#1a4d2e";
                        ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
                        ctx.fillStyle = "#2d8659";
                        ctx.fillRect(px + 3, py + 3, TILE_SIZE - 6, TILE_SIZE - 6);
                    } else {
                        const elapsed = Date.now() - zone.usedAt;
                        const opacity = 1 - (elapsed / 3000);
                        ctx.fillStyle = `rgba(26, 77, 46, ${opacity})`;
                        ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
                        ctx.fillStyle = `rgba(45, 134, 89, ${opacity})`;
                        ctx.fillRect(px + 3, py + 3, TILE_SIZE - 6, TILE_SIZE - 6);
                        
                        ctx.strokeStyle = `rgba(100, 0, 0, ${1 - opacity})`;
                        ctx.lineWidth = 2;
                        ctx.beginPath();
                        ctx.moveTo(px, py);
                        ctx.lineTo(px + TILE_SIZE, py + TILE_SIZE);
                        ctx.moveTo(px + TILE_SIZE, py);
                        ctx.lineTo(px, py + TILE_SIZE);
                        ctx.stroke();
                    }
                    
                    if (zone.magnetStrength > 0) {
                        const alpha = zone.magnetStrength / 100;
                        ctx.fillStyle = `rgba(255, 0, 0, ${alpha * 0.3})`;
                        ctx.beginPath();
                        ctx.arc(px + TILE_SIZE/2, py + TILE_SIZE/2, TILE_SIZE/2 + 5, 0, Math.PI * 2);
                        ctx.fill();
                    }
                }
            } else {
                ctx.fillStyle = "#0f0f1e";
                ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
                ctx.strokeStyle = "#1a1a2e";
                ctx.strokeRect(px, py, TILE_SIZE, TILE_SIZE);
            }
        }
    }

    // Draw spikes
    game.spikes.forEach(spike => {
        const px = spike.x * TILE_SIZE;
        const py = spike.y * TILE_SIZE;
        ctx.fillStyle = spike.active ? "#a00" : "#333";
        ctx.fillRect(px + 5, py + 5, TILE_SIZE - 10, TILE_SIZE - 10);
        
        if (spike.active) {
            ctx.fillStyle = "#600";
            for (let i = 0; i < 3; i++) {
                ctx.beginPath();
                ctx.moveTo(px + 7 + i * 6, py + TILE_SIZE - 7);
                ctx.lineTo(px + 10 + i * 6, py + 7);
                ctx.lineTo(px + 13 + i * 6, py + TILE_SIZE - 7);
                ctx.fill();
            }
        }
    });

    // Draw bomb pickups
    game.bombPickups.forEach(bomb => {
        if (!bomb.collected) {
            const px = bomb.x * TILE_SIZE + TILE_SIZE/2;
            const py = bomb.y * TILE_SIZE + TILE_SIZE/2;
            
            // Bomb glow
            const bombGradient = ctx.createRadialGradient(px, py, 0, px, py, 12);
            bombGradient.addColorStop(0, "rgba(255, 100, 100, 0.8)");
            bombGradient.addColorStop(1, "rgba(255, 100, 100, 0)");
            ctx.fillStyle = bombGradient;
            ctx.beginPath();
            ctx.arc(px, py, 12, 0, Math.PI * 2);
            ctx.fill();
            
            // Bomb body (black circle)
            ctx.fillStyle = "#333";
            ctx.beginPath();
            ctx.arc(px, py, 8, 0, Math.PI * 2);
            ctx.fill();
            
            // Fuse (red line)
            ctx.strokeStyle = "#ff0000";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(px, py - 8);
            ctx.lineTo(px, py - 12);
            ctx.stroke();
            
            // Spark at top of fuse
            ctx.fillStyle = "#ffaa00";
            ctx.beginPath();
            ctx.arc(px, py - 12, 2, 0, Math.PI * 2);
            ctx.fill();
        }
    });
    
    // Draw placed bomb (if exists) - with beeping animation
    if (game.placedBomb) {
        const px = game.placedBomb.x * TILE_SIZE + TILE_SIZE/2;
        const py = game.placedBomb.y * TILE_SIZE + TILE_SIZE/2;
        const timeSincePlaced = Date.now() - game.placedBomb.placedAt;
        const timeLeft = 1000 - timeSincePlaced;
        
        // Beeping effect - faster beeps as explosion nears
        const beepSpeed = Math.max(2, 10 - (timeSincePlaced / 1000) * 8); // Faster beeps
        const beepPhase = (timeSincePlaced * beepSpeed) % 200;
        const isBeeping = beepPhase < 100; // Beep on/off cycle
        
        // Pulsing red glow (intensifies as explosion approaches)
        const intensity = 0.4 + (timeSincePlaced / 1000) * 0.6; // Gets brighter
        const glowRadius = 12 + Math.sin(timeSincePlaced * 0.03) * 3; // Pulsing size
        const bombGradient = ctx.createRadialGradient(px, py, 0, px, py, glowRadius);
        bombGradient.addColorStop(0, `rgba(255, 0, 0, ${0.9 * intensity})`);
        bombGradient.addColorStop(0.5, `rgba(255, 100, 0, ${0.5 * intensity})`);
        bombGradient.addColorStop(1, `rgba(255, 0, 0, 0)`);
        ctx.fillStyle = bombGradient;
        ctx.beginPath();
        ctx.arc(px, py, glowRadius, 0, Math.PI * 2);
        ctx.fill();
        
        // Bomb body (flashing red/black during beep)
        ctx.fillStyle = isBeeping ? "#ff0000" : "#333";
        ctx.beginPath();
        ctx.arc(px, py, 8, 0, Math.PI * 2);
        ctx.fill();
        
        // Fuse (shorter as time runs out)
        const fuseLength = Math.max(2, 4 - (timeSincePlaced / 1000) * 2);
        ctx.strokeStyle = isBeeping ? "#ffff00" : "#ffaa00";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(px, py - 8);
        ctx.lineTo(px, py - 8 - fuseLength);
        ctx.stroke();
        
        // Spark (brighter when beeping)
        ctx.fillStyle = isBeeping ? "#ffffff" : "#ffff00";
        ctx.beginPath();
        ctx.arc(px, py - 8 - fuseLength, isBeeping ? 4 : 3, 0, Math.PI * 2);
        ctx.fill();
        
        // Warning text (last 300ms)
        if (timeLeft < 300) {
            ctx.fillStyle = "#ffffff";
            ctx.font = "bold 12px Arial";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText("!", px, py - 20);
        }
    }
    
    // Draw explosion wave animation
    if (game.explosion) {
        const px = game.explosion.x * TILE_SIZE + TILE_SIZE/2;
        const py = game.explosion.y * TILE_SIZE + TILE_SIZE/2;
        const timeSinceExplosion = Date.now() - game.explosion.startTime;
        const duration = 300; // 300ms explosion animation
        
        if (timeSinceExplosion < duration) {
            const progress = timeSinceExplosion / duration;
            const maxRadius = TILE_SIZE * 1.5;
            const currentRadius = maxRadius * progress;
            
            // Multiple expanding rings
            for (let i = 0; i < 3; i++) {
                const ringProgress = (progress - i * 0.2) % 1;
                if (ringProgress < 0 || ringProgress > 0.8) continue;
                
                const ringRadius = maxRadius * ringProgress;
                const alpha = 1 - ringProgress;
                
                // Outer explosion ring (orange/yellow)
                const explosionGradient = ctx.createRadialGradient(px, py, 0, px, py, ringRadius);
                explosionGradient.addColorStop(0, `rgba(255, 200, 0, ${alpha * 0.8})`);
                explosionGradient.addColorStop(0.5, `rgba(255, 100, 0, ${alpha * 0.6})`);
                explosionGradient.addColorStop(1, `rgba(255, 0, 0, 0)`);
                ctx.fillStyle = explosionGradient;
                ctx.beginPath();
                ctx.arc(px, py, ringRadius, 0, Math.PI * 2);
                ctx.fill();
            }
            
            // Center flash
            const centerAlpha = 1 - progress;
            ctx.fillStyle = `rgba(255, 255, 255, ${centerAlpha})`;
            ctx.beginPath();
            ctx.arc(px, py, 5, 0, Math.PI * 2);
            ctx.fill();
        }
    }
    
    // Draw breaking walls animation
    game.breakingWalls.forEach(wall => {
        const px = wall.x * TILE_SIZE;
        const py = wall.y * TILE_SIZE;
        const timeSinceBreak = Date.now() - wall.startTime;
        const duration = 500; // 500ms breaking animation
        
        if (timeSinceBreak < duration) {
            const progress = timeSinceBreak / duration;
            const alpha = 1 - progress;
            
            // Draw wall fragments falling
            ctx.save();
            ctx.globalAlpha = alpha;
            
            // Original wall color fading
            ctx.fillStyle = "#2d3561";
            ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
            
            // Fragments (small squares falling)
            const fragmentCount = 8;
            for (let i = 0; i < fragmentCount; i++) {
                const angle = (i / fragmentCount) * Math.PI * 2;
                const distance = progress * 15;
                const fragX = px + TILE_SIZE/2 + Math.cos(angle) * distance;
                const fragY = py + TILE_SIZE/2 + Math.sin(angle) * distance + progress * 20; // Fall down
                
                ctx.fillStyle = "#1a1f3a";
                ctx.fillRect(fragX - 2, fragY - 2, 4, 4);
            }
            
            ctx.restore();
        }
    });

    // Draw player trail
    game.playerTrail.forEach((pos, i) => {
        const alpha = (1 - i / game.playerTrail.length) * 0.3;
        ctx.fillStyle = `rgba(0, 255, 255, ${alpha})`;
        ctx.fillRect(pos.x * TILE_SIZE + 10, pos.y * TILE_SIZE + 10, 10, 10);
    });


    // Draw keys as glowing rotating stars
    game.keys.forEach(key => {
        if (!key.collected) {
            const px = key.x * TILE_SIZE + TILE_SIZE/2;
            const py = key.y * TILE_SIZE + TILE_SIZE/2;
            const keyTime = Date.now() * 0.001; // Slow rotation
            const glowIntensity = 0.6 + Math.sin(keyTime * 3) * 0.3; // Pulsing glow
            
            // Outer glow
            const glowGradient = ctx.createRadialGradient(px, py, 0, px, py, 18);
            glowGradient.addColorStop(0, `rgba(255, 215, 0, ${0.9 * glowIntensity})`);
            glowGradient.addColorStop(0.5, `rgba(255, 215, 0, ${0.5 * glowIntensity})`);
            glowGradient.addColorStop(1, `rgba(255, 215, 0, 0)`);
            ctx.fillStyle = glowGradient;
            ctx.beginPath();
            ctx.arc(px, py, 18, 0, Math.PI * 2);
            ctx.fill();
            
            // Draw star shape (rotating)
            ctx.save();
            ctx.translate(px, py);
            ctx.rotate(keyTime); // Slow rotation
            ctx.fillStyle = "#ffd700";
            ctx.strokeStyle = "#ffed4e";
            ctx.lineWidth = 1.5;
            
            // 5-pointed star
            ctx.beginPath();
            const starPoints = 5;
            const outerRadius = 9;
            const innerRadius = 4;
            for (let i = 0; i < starPoints * 2; i++) {
                const angle = (i * Math.PI) / starPoints;
                const radius = i % 2 === 0 ? outerRadius : innerRadius;
                const x = Math.cos(angle) * radius;
                const y = Math.sin(angle) * radius;
                if (i === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            }
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.restore();
        }
    });

    // Draw powerups
    game.powerups.forEach(powerup => {
        if (!powerup.collected) {
            const px = powerup.x * TILE_SIZE + TILE_SIZE/2;
            const py = powerup.y * TILE_SIZE + TILE_SIZE/2;
            
            ctx.fillStyle = "#0af";
            ctx.beginPath();
            ctx.arc(px, py, 7, 0, Math.PI * 2);
            ctx.fill();
            
            ctx.fillStyle = "#fff";
            ctx.font = "16px Arial";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText("⚡", px, py);
        }
    });

    // Draw exit door
    const exitX = game.exit.x * TILE_SIZE;
    const exitY = game.exit.y * TILE_SIZE;
    const isOpen = game.keysCollected === 3;
    
    if (isOpen) {
        // Draw open door (two halves opened outward)
        const doorWidth = TILE_SIZE - 4;
        const doorHeight = TILE_SIZE - 4;
        const halfWidth = doorWidth / 2;
        
        // Left door panel (opened)
        ctx.save();
        ctx.translate(exitX + TILE_SIZE/2, exitY + TILE_SIZE/2);
        ctx.rotate(-Math.PI / 4); // Rotate left
        ctx.fillStyle = "#8B4513"; // Brown door color
        ctx.fillRect(-halfWidth/2, -doorHeight/2, halfWidth, doorHeight);
        ctx.strokeStyle = "#654321";
        ctx.lineWidth = 2;
        ctx.strokeRect(-halfWidth/2, -doorHeight/2, halfWidth, doorHeight);
        // Door handle
        ctx.fillStyle = "#FFD700";
        ctx.beginPath();
        ctx.arc(halfWidth/2 - 3, 0, 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        
        // Right door panel (opened)
        ctx.save();
        ctx.translate(exitX + TILE_SIZE/2, exitY + TILE_SIZE/2);
        ctx.rotate(Math.PI / 4); // Rotate right
        ctx.fillStyle = "#8B4513";
        ctx.fillRect(-halfWidth/2, -doorHeight/2, halfWidth, doorHeight);
        ctx.strokeStyle = "#654321";
        ctx.lineWidth = 2;
        ctx.strokeRect(-halfWidth/2, -doorHeight/2, halfWidth, doorHeight);
        // Door handle
        ctx.fillStyle = "#FFD700";
        ctx.beginPath();
        ctx.arc(-halfWidth/2 + 3, 0, 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        
        // Open door glow
        const gradient = ctx.createRadialGradient(
            exitX + TILE_SIZE/2, exitY + TILE_SIZE/2, 0,
            exitX + TILE_SIZE/2, exitY + TILE_SIZE/2, TILE_SIZE
        );
        gradient.addColorStop(0, "rgba(0, 255, 0, 0.3)");
        gradient.addColorStop(1, "rgba(0, 255, 0, 0)");
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(exitX + TILE_SIZE/2, exitY + TILE_SIZE/2, TILE_SIZE, 0, Math.PI * 2);
        ctx.fill();
    } else {
        // Draw closed door
        const doorWidth = TILE_SIZE - 4;
        const doorHeight = TILE_SIZE - 4;
        
        // Door frame
        ctx.fillStyle = "#654321";
        ctx.fillRect(exitX + 2, exitY + 2, doorWidth, doorHeight);
        ctx.strokeStyle = "#3d2817";
        ctx.lineWidth = 2;
        ctx.strokeRect(exitX + 2, exitY + 2, doorWidth, doorHeight);
        
        // Door panels (two vertical panels)
        ctx.fillStyle = "#8B4513";
        ctx.fillRect(exitX + 4, exitY + 4, doorWidth/2 - 1, doorHeight - 4);
        ctx.fillRect(exitX + TILE_SIZE/2 + 1, exitY + 4, doorWidth/2 - 1, doorHeight - 4);
        
        // Door frame details
        ctx.strokeStyle = "#3d2817";
        ctx.lineWidth = 1;
        // Vertical divider
        ctx.beginPath();
        ctx.moveTo(exitX + TILE_SIZE/2, exitY + 4);
        ctx.lineTo(exitX + TILE_SIZE/2, exitY + TILE_SIZE - 4);
        ctx.stroke();
        // Horizontal crossbar
        ctx.beginPath();
        ctx.moveTo(exitX + 4, exitY + TILE_SIZE/2);
        ctx.lineTo(exitX + TILE_SIZE - 4, exitY + TILE_SIZE/2);
        ctx.stroke();
        
        // Door handles
        ctx.fillStyle = "#FFD700";
        ctx.beginPath();
        ctx.arc(exitX + TILE_SIZE/2 - 4, exitY + TILE_SIZE/2, 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(exitX + TILE_SIZE/2 + 4, exitY + TILE_SIZE/2, 2, 0, Math.PI * 2);
        ctx.fill();
        
        // Lock indicator (red X)
        ctx.strokeStyle = "#ff4444";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(exitX + TILE_SIZE/2 - 4, exitY + TILE_SIZE/2 - 4);
        ctx.lineTo(exitX + TILE_SIZE/2 + 4, exitY + TILE_SIZE/2 + 4);
        ctx.moveTo(exitX + TILE_SIZE/2 + 4, exitY + TILE_SIZE/2 - 4);
        ctx.lineTo(exitX + TILE_SIZE/2 - 4, exitY + TILE_SIZE/2 + 4);
        ctx.stroke();
        
        // Closed door warning glow
        const gradient = ctx.createRadialGradient(
            exitX + TILE_SIZE/2, exitY + TILE_SIZE/2, 0,
            exitX + TILE_SIZE/2, exitY + TILE_SIZE/2, TILE_SIZE
        );
        gradient.addColorStop(0, "rgba(255, 68, 68, 0.2)");
        gradient.addColorStop(1, "rgba(255, 68, 68, 0)");
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(exitX + TILE_SIZE/2, exitY + TILE_SIZE/2, TILE_SIZE, 0, Math.PI * 2);
        ctx.fill();
    }

    // Draw player (angel)
    const playerX = game.player.x * TILE_SIZE + TILE_SIZE/2;
    const playerY = game.player.y * TILE_SIZE + TILE_SIZE/2;
    const playerFlash = game.invulnFrames > 0 && game.frameCount % 4 < 2;
    const playerTime = Date.now() * 0.003;
    
    // Scale to match monster size (TILE_SIZE/2 - 4 = 11 radius)
    const playerBodyRadius = TILE_SIZE/2 - 4; // Same as monster
    
    if (!playerFlash) {
        // Halo glow
        const haloGlow = ctx.createRadialGradient(playerX, playerY - 4, 0, playerX, playerY - 4, playerBodyRadius + 2);
        haloGlow.addColorStop(0, "rgba(255, 215, 0, 0.8)");
        haloGlow.addColorStop(0.5, "rgba(255, 255, 200, 0.4)");
        haloGlow.addColorStop(1, "rgba(255, 215, 0, 0)");
        ctx.fillStyle = haloGlow;
        ctx.beginPath();
        ctx.arc(playerX, playerY - 4, playerBodyRadius + 2, 0, Math.PI * 2);
        ctx.fill();
        
        // Halo ring
        ctx.strokeStyle = "#ffd700";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(playerX, playerY - 4, playerBodyRadius + 1, 3, 0, 0, Math.PI * 2);
        ctx.stroke();
        
        // Wings (behind body, with animation)
        const wingFlap = Math.sin(playerTime * 2) * 0.15;
        ctx.save();
        ctx.translate(playerX, playerY);
        
        // Left wing
        ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
        ctx.beginPath();
        ctx.ellipse(-playerBodyRadius - 2, 0, playerBodyRadius * 0.4, playerBodyRadius * 0.6 + wingFlap * 2, -0.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#ddd";
        ctx.lineWidth = 1;
        ctx.stroke();
        
        // Right wing
        ctx.beginPath();
        ctx.ellipse(playerBodyRadius + 2, 0, playerBodyRadius * 0.4, playerBodyRadius * 0.6 + wingFlap * 2, 0.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        
        ctx.restore();
        
        // Body (white circle with gradient)
        const bodyGradient = ctx.createRadialGradient(playerX, playerY, 0, playerX, playerY, playerBodyRadius);
        bodyGradient.addColorStop(0, "#ffffff");
        bodyGradient.addColorStop(0.7, "#f0f0f0");
        bodyGradient.addColorStop(1, "#e0e0e0");
        ctx.fillStyle = bodyGradient;
        ctx.beginPath();
        ctx.arc(playerX, playerY, playerBodyRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#ccc";
        ctx.lineWidth = 2;
        ctx.stroke();
        
        // Face (beige circle)
        ctx.fillStyle = "#ffe4b5";
        ctx.beginPath();
        ctx.arc(playerX, playerY, playerBodyRadius * 0.5, 0, Math.PI * 2);
        ctx.fill();
        
        // Eyes (two black dots)
        ctx.fillStyle = "#000";
        ctx.beginPath();
        ctx.arc(playerX - playerBodyRadius * 0.25, playerY - playerBodyRadius * 0.1, playerBodyRadius * 0.12, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(playerX + playerBodyRadius * 0.25, playerY - playerBodyRadius * 0.1, playerBodyRadius * 0.12, 0, Math.PI * 2);
        ctx.fill();
    }

    // Draw monster detection radius
    if (game.monsterAlertLevel > 0) {
        const alpha = game.monsterAlertLevel / 100 * 0.2;
        ctx.fillStyle = `rgba(255, 0, 0, ${alpha})`;
        ctx.beginPath();
        ctx.arc(game.monster.x * TILE_SIZE + TILE_SIZE/2, 
               game.monster.y * TILE_SIZE + TILE_SIZE/2, 
               game.monsterDetectionRadius * TILE_SIZE, 0, Math.PI * 2);
        ctx.fill();
    }

    // Draw monster
    const monsterX = game.monster.x * TILE_SIZE + TILE_SIZE/2;
    const monsterY = game.monster.y * TILE_SIZE + TILE_SIZE/2;
    const time = Date.now() * 0.005;
    
    // Outer glow
    const outerGlow = ctx.createRadialGradient(monsterX, monsterY, 0, monsterX, monsterY, TILE_SIZE);
    outerGlow.addColorStop(0, "rgba(255, 0, 0, 0.6)");
    outerGlow.addColorStop(0.5, "rgba(200, 0, 0, 0.3)");
    outerGlow.addColorStop(1, "rgba(139, 0, 0, 0)");
    ctx.fillStyle = outerGlow;
    ctx.beginPath();
    ctx.arc(monsterX, monsterY, TILE_SIZE, 0, Math.PI * 2);
    ctx.fill();
    
    // Main body
    const bodyGradient = ctx.createRadialGradient(monsterX, monsterY - 2, 0, monsterX, monsterY, TILE_SIZE/2 - 4);
    bodyGradient.addColorStop(0, "#ff4444");
    bodyGradient.addColorStop(0.5, "#cc0000");
    bodyGradient.addColorStop(1, "#990000");
    ctx.fillStyle = bodyGradient;
    ctx.beginPath();
    ctx.arc(monsterX, monsterY, TILE_SIZE/2 - 4, 0, Math.PI * 2);
    ctx.fill();
    
    // Spikes/tentacles
    ctx.fillStyle = "#880000";
    for (let i = 0; i < 8; i++) {
        const angle = (i * Math.PI * 2) / 8 + time;
        const spikeX = monsterX + Math.cos(angle) * (TILE_SIZE/2 - 2);
        const spikeY = monsterY + Math.sin(angle) * (TILE_SIZE/2 - 2);
        ctx.beginPath();
        ctx.arc(spikeX, spikeY, 2, 0, Math.PI * 2);
        ctx.fill();
    }
    
    // Eyes
    ctx.fillStyle = "#000000";
    ctx.beginPath();
    ctx.arc(monsterX - 5, monsterY - 3, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(monsterX + 5, monsterY - 3, 3, 0, Math.PI * 2);
    ctx.fill();
    
    // Outline
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(monsterX, monsterY, TILE_SIZE/2 - 4, 0, Math.PI * 2);
    ctx.stroke();

    // Draw win/lose screens
    if (game.won) {
        ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        ctx.fillStyle = "#00ff00";
        ctx.font = "bold 48px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("YOU ESCAPED!", canvas.width/2, canvas.height/2 - 20);
        
        ctx.fillStyle = "#ffffff";
        ctx.font = "20px Arial";
        const time = Math.floor((game.endTime - game.startTime) / 1000);
        ctx.fillText(`Time: ${time}s | Deaths: ${game.deaths}`, canvas.width/2, canvas.height/2 + 30);
        ctx.fillText("Press R to restart", canvas.width/2, canvas.height/2 + 70);
    } else if (game.gameOver) {
        ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        ctx.fillStyle = "#ff0000";
        ctx.font = "bold 48px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("GAME OVER", canvas.width/2, canvas.height/2 - 20);
        
        ctx.fillStyle = "#ffffff";
        ctx.font = "20px Arial";
        ctx.fillText("Press R to restart", canvas.width/2, canvas.height/2 + 30);
    }
}

// Input handlers
document.addEventListener('keydown', (e) => {
    // Prevent default for space bar to avoid scrolling
    if (e.key === ' ' || e.key === 'Space') {
        e.preventDefault();
    }
    
    input.keys[e.key] = true;
    
    if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        init();
    }
});

document.addEventListener('keyup', (e) => {
    input.keys[e.key] = false;
});

// Draw legend icons using same code as game
function drawLegendIcons() {
    const legendSize = 30;
    const center = legendSize / 2;
    
    // Draw key (star)
    const keyCanvas = document.getElementById('legend-key');
    if (keyCanvas) {
        const keyCtx = keyCanvas.getContext('2d');
        keyCtx.fillStyle = "#0f0f1e";
        keyCtx.fillRect(0, 0, legendSize, legendSize);
        
        const keyTime = Date.now() * 0.001;
        const glowIntensity = 0.6 + Math.sin(keyTime * 3) * 0.3;
        
        // Outer glow
        const glowGradient = keyCtx.createRadialGradient(center, center, 0, center, center, 18);
        glowGradient.addColorStop(0, `rgba(255, 215, 0, ${0.9 * glowIntensity})`);
        glowGradient.addColorStop(0.5, `rgba(255, 215, 0, ${0.5 * glowIntensity})`);
        glowGradient.addColorStop(1, `rgba(255, 215, 0, 0)`);
        keyCtx.fillStyle = glowGradient;
        keyCtx.beginPath();
        keyCtx.arc(center, center, 18, 0, Math.PI * 2);
        keyCtx.fill();
        
        // Star shape
        keyCtx.save();
        keyCtx.translate(center, center);
        keyCtx.rotate(keyTime);
        keyCtx.fillStyle = "#ffd700";
        keyCtx.strokeStyle = "#ffed4e";
        keyCtx.lineWidth = 1.5;
        keyCtx.beginPath();
        const starPoints = 5;
        const outerRadius = 9;
        const innerRadius = 4;
        for (let i = 0; i < starPoints * 2; i++) {
            const angle = (i * Math.PI) / starPoints;
            const radius = i % 2 === 0 ? outerRadius : innerRadius;
            const x = Math.cos(angle) * radius;
            const y = Math.sin(angle) * radius;
            if (i === 0) {
                keyCtx.moveTo(x, y);
            } else {
                keyCtx.lineTo(x, y);
            }
        }
        keyCtx.closePath();
        keyCtx.fill();
        keyCtx.stroke();
        keyCtx.restore();
    }
    
    // Draw exit door
    const doorCanvas = document.getElementById('legend-door');
    if (doorCanvas) {
        const doorCtx = doorCanvas.getContext('2d');
        doorCtx.fillStyle = "#0f0f1e";
        doorCtx.fillRect(0, 0, legendSize, legendSize);
        
        // Closed door
        const doorWidth = legendSize - 4;
        const doorHeight = legendSize - 4;
        doorCtx.fillStyle = "#654321";
        doorCtx.fillRect(2, 2, doorWidth, doorHeight);
        doorCtx.strokeStyle = "#3d2817";
        doorCtx.lineWidth = 2;
        doorCtx.strokeRect(2, 2, doorWidth, doorHeight);
        
        doorCtx.fillStyle = "#8B4513";
        doorCtx.fillRect(4, 4, doorWidth/2 - 1, doorHeight - 4);
        doorCtx.fillRect(legendSize/2 + 1, 4, doorWidth/2 - 1, doorHeight - 4);
        
        doorCtx.strokeStyle = "#3d2817";
        doorCtx.lineWidth = 1;
        doorCtx.beginPath();
        doorCtx.moveTo(legendSize/2, 4);
        doorCtx.lineTo(legendSize/2, legendSize - 4);
        doorCtx.stroke();
        doorCtx.beginPath();
        doorCtx.moveTo(4, legendSize/2);
        doorCtx.lineTo(legendSize - 4, legendSize/2);
        doorCtx.stroke();
        
        doorCtx.fillStyle = "#FFD700";
        doorCtx.beginPath();
        doorCtx.arc(legendSize/2 - 4, legendSize/2, 2, 0, Math.PI * 2);
        doorCtx.fill();
        doorCtx.beginPath();
        doorCtx.arc(legendSize/2 + 4, legendSize/2, 2, 0, Math.PI * 2);
        doorCtx.fill();
        
        doorCtx.strokeStyle = "#ff4444";
        doorCtx.lineWidth = 2;
        doorCtx.beginPath();
        doorCtx.moveTo(legendSize/2 - 4, legendSize/2 - 4);
        doorCtx.lineTo(legendSize/2 + 4, legendSize/2 + 4);
        doorCtx.moveTo(legendSize/2 + 4, legendSize/2 - 4);
        doorCtx.lineTo(legendSize/2 - 4, legendSize/2 + 4);
        doorCtx.stroke();
    }
    
    // Draw monster
    const monsterCanvas = document.getElementById('legend-monster');
    if (monsterCanvas) {
        const monsterCtx = monsterCanvas.getContext('2d');
        monsterCtx.fillStyle = "#0f0f1e";
        monsterCtx.fillRect(0, 0, legendSize, legendSize);
        
        const time = Date.now() * 0.005;
        
        // Outer glow
        const outerGlow = monsterCtx.createRadialGradient(center, center, 0, center, center, legendSize);
        outerGlow.addColorStop(0, "rgba(255, 0, 0, 0.6)");
        outerGlow.addColorStop(0.5, "rgba(200, 0, 0, 0.3)");
        outerGlow.addColorStop(1, "rgba(139, 0, 0, 0)");
        monsterCtx.fillStyle = outerGlow;
        monsterCtx.beginPath();
        monsterCtx.arc(center, center, legendSize, 0, Math.PI * 2);
        monsterCtx.fill();
        
        // Main body
        const bodyGradient = monsterCtx.createRadialGradient(center, center - 2, 0, center, center, legendSize/2 - 4);
        bodyGradient.addColorStop(0, "#ff4444");
        bodyGradient.addColorStop(0.5, "#cc0000");
        bodyGradient.addColorStop(1, "#990000");
        monsterCtx.fillStyle = bodyGradient;
        monsterCtx.beginPath();
        monsterCtx.arc(center, center, legendSize/2 - 4, 0, Math.PI * 2);
        monsterCtx.fill();
        
        // Spikes
        monsterCtx.fillStyle = "#880000";
        for (let i = 0; i < 8; i++) {
            const angle = (i * Math.PI * 2) / 8 + time;
            const spikeX = center + Math.cos(angle) * (legendSize/2 - 2);
            const spikeY = center + Math.sin(angle) * (legendSize/2 - 2);
            monsterCtx.beginPath();
            monsterCtx.arc(spikeX, spikeY, 2, 0, Math.PI * 2);
            monsterCtx.fill();
        }
        
        // Eyes
        monsterCtx.fillStyle = "#000000";
        monsterCtx.beginPath();
        monsterCtx.arc(center - 5, center - 3, 3, 0, Math.PI * 2);
        monsterCtx.fill();
        monsterCtx.beginPath();
        monsterCtx.arc(center + 5, center - 3, 3, 0, Math.PI * 2);
        monsterCtx.fill();
        
        // Outline
        monsterCtx.strokeStyle = "#000000";
        monsterCtx.lineWidth = 2;
        monsterCtx.beginPath();
        monsterCtx.arc(center, center, legendSize/2 - 4, 0, Math.PI * 2);
        monsterCtx.stroke();
    }
    
    // Draw player (angel) - scaled to match game size
    const playerCanvas = document.getElementById('legend-player');
    if (playerCanvas) {
        const playerCtx = playerCanvas.getContext('2d');
        playerCtx.fillStyle = "#0f0f1e";
        playerCtx.fillRect(0, 0, legendSize, legendSize);
        
        const playerTime = Date.now() * 0.003;
        // Scale to match game player size (TILE_SIZE/2 - 4 = 11, scaled for 30px canvas)
        const scale = legendSize / TILE_SIZE; // 30/30 = 1, but we want proportional
        const playerBodyRadius = (TILE_SIZE/2 - 4) * scale; // ~11 pixels
        
        // Halo glow
        const haloGradient = playerCtx.createRadialGradient(center, center - 4, 0, center, center - 4, playerBodyRadius + 2);
        haloGradient.addColorStop(0, "rgba(255, 215, 0, 0.8)");
        haloGradient.addColorStop(0.5, "rgba(255, 255, 200, 0.4)");
        haloGradient.addColorStop(1, "rgba(255, 215, 0, 0)");
        playerCtx.fillStyle = haloGradient;
        playerCtx.beginPath();
        playerCtx.arc(center, center - 4, playerBodyRadius + 2, 0, Math.PI * 2);
        playerCtx.fill();
        
        // Halo ring
        playerCtx.strokeStyle = "#ffd700";
        playerCtx.lineWidth = 2;
        playerCtx.beginPath();
        playerCtx.ellipse(center, center - 4, playerBodyRadius + 1, 3, 0, 0, Math.PI * 2);
        playerCtx.stroke();
        
        // Wings
        const wingFlap = Math.sin(playerTime * 2) * 0.15;
        playerCtx.save();
        playerCtx.translate(center, center);
        
        // Left wing
        playerCtx.fillStyle = "rgba(255, 255, 255, 0.8)";
        playerCtx.beginPath();
        playerCtx.ellipse(-playerBodyRadius - 2, 0, playerBodyRadius * 0.4, playerBodyRadius * 0.6 + wingFlap * 2, -0.3, 0, Math.PI * 2);
        playerCtx.fill();
        playerCtx.strokeStyle = "#ddd";
        playerCtx.lineWidth = 1;
        playerCtx.stroke();
        
        // Right wing
        playerCtx.beginPath();
        playerCtx.ellipse(playerBodyRadius + 2, 0, playerBodyRadius * 0.4, playerBodyRadius * 0.6 + wingFlap * 2, 0.3, 0, Math.PI * 2);
        playerCtx.fill();
        playerCtx.stroke();
        
        playerCtx.restore();
        
        // Body
        const bodyGradient = playerCtx.createRadialGradient(center, center, 0, center, center, playerBodyRadius);
        bodyGradient.addColorStop(0, "#ffffff");
        bodyGradient.addColorStop(0.7, "#f0f0f0");
        bodyGradient.addColorStop(1, "#e0e0e0");
        playerCtx.fillStyle = bodyGradient;
        playerCtx.beginPath();
        playerCtx.arc(center, center, playerBodyRadius, 0, Math.PI * 2);
        playerCtx.fill();
        playerCtx.strokeStyle = "#ccc";
        playerCtx.lineWidth = 2;
        playerCtx.stroke();
        
        // Face
        playerCtx.fillStyle = "#ffe4b5";
        playerCtx.beginPath();
        playerCtx.arc(center, center, playerBodyRadius * 0.5, 0, Math.PI * 2);
        playerCtx.fill();
        
        // Eyes
        playerCtx.fillStyle = "#000";
        playerCtx.beginPath();
        playerCtx.arc(center - playerBodyRadius * 0.25, center - playerBodyRadius * 0.1, playerBodyRadius * 0.12, 0, Math.PI * 2);
        playerCtx.fill();
        playerCtx.beginPath();
        playerCtx.arc(center + playerBodyRadius * 0.25, center - playerBodyRadius * 0.1, playerBodyRadius * 0.12, 0, Math.PI * 2);
        playerCtx.fill();
    }
    
    // Draw spike
    const spikeCanvas = document.getElementById('legend-spike');
    if (spikeCanvas) {
        const spikeCtx = spikeCanvas.getContext('2d');
        spikeCtx.fillStyle = "#0f0f1e";
        spikeCtx.fillRect(0, 0, legendSize, legendSize);
        
        spikeCtx.fillStyle = "#a00";
        spikeCtx.fillRect(5, 5, legendSize - 10, legendSize - 10);
        
        spikeCtx.fillStyle = "#600";
        for (let i = 0; i < 3; i++) {
            spikeCtx.beginPath();
            spikeCtx.moveTo(7 + i * 6, legendSize - 7);
            spikeCtx.lineTo(10 + i * 6, 7);
            spikeCtx.lineTo(13 + i * 6, legendSize - 7);
            spikeCtx.fill();
        }
    }
    
    // Draw bomb pickup
    const bombCanvas = document.getElementById('legend-bomb');
    if (bombCanvas) {
        const bombCtx = bombCanvas.getContext('2d');
        bombCtx.fillStyle = "#0f0f1e";
        bombCtx.fillRect(0, 0, legendSize, legendSize);
        
        // Bomb glow
        const bombGradient = bombCtx.createRadialGradient(center, center, 0, center, center, 12);
        bombGradient.addColorStop(0, "rgba(255, 100, 100, 0.8)");
        bombGradient.addColorStop(1, "rgba(255, 100, 100, 0)");
        bombCtx.fillStyle = bombGradient;
        bombCtx.beginPath();
        bombCtx.arc(center, center, 12, 0, Math.PI * 2);
        bombCtx.fill();
        
        // Bomb body
        bombCtx.fillStyle = "#333";
        bombCtx.beginPath();
        bombCtx.arc(center, center, 8, 0, Math.PI * 2);
        bombCtx.fill();
        
        // Fuse
        bombCtx.strokeStyle = "#ff0000";
        bombCtx.lineWidth = 2;
        bombCtx.beginPath();
        bombCtx.moveTo(center, center - 8);
        bombCtx.lineTo(center, center - 12);
        bombCtx.stroke();
        
        // Spark
        bombCtx.fillStyle = "#ffaa00";
        bombCtx.beginPath();
        bombCtx.arc(center, center - 12, 2, 0, Math.PI * 2);
        bombCtx.fill();
    }
    
    // Draw powerup
    const powerupCanvas = document.getElementById('legend-powerup');
    if (powerupCanvas) {
        const powerupCtx = powerupCanvas.getContext('2d');
        powerupCtx.fillStyle = "#0f0f1e";
        powerupCtx.fillRect(0, 0, legendSize, legendSize);
        
        powerupCtx.fillStyle = "#0af";
        powerupCtx.beginPath();
        powerupCtx.arc(center, center, 7, 0, Math.PI * 2);
        powerupCtx.fill();
        
        powerupCtx.fillStyle = "#fff";
        powerupCtx.font = "16px Arial";
        powerupCtx.textAlign = "center";
        powerupCtx.textBaseline = "middle";
        powerupCtx.fillText("⚡", center, center);
    }
}

// Button event listeners
const resetBtn = document.getElementById('resetBtn');
const skipBtn = document.getElementById('skipBtn');

if (resetBtn) {
    resetBtn.addEventListener('click', () => {
        resetLevel();
    });
}

if (skipBtn) {
    skipBtn.addEventListener('click', () => {
        skipLevel();
    });
}

// Start game
if (canvas && ctx) {
    init();
    gameLoop();
    drawLegendIcons();
    // Update legend icons periodically for animations
    setInterval(drawLegendIcons, 50);
} else {
    console.error("Failed to initialize game: Canvas or context not available");
    document.body.innerHTML += '<div style="color: red; padding: 20px; text-align: center;">Error: Game canvas not found. Please check the HTML file.</div>';
}