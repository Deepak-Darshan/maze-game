const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

const TILE_SIZE = 30;
const N = 21;

// Tile types
const FLOOR = 0;
const WALL = 1;
const SAFE = 2;
const KEY = 3;
const EXIT = 4;
const DOOR = 5;

// Game state
const game = {
    maze: [],
    player: { x: 1, y: 1 },
    monster: null,
    keys: [],
    keysCollected: 0,
    exit: { x: N-2, y: N-2 },
    safeZones: [],
    gameOver: false,
    won: false,
    deaths: 0,
    startTime: Date.now(),
    lastMoveTime: 0,
    moveDelay: 150,
    playerTrail: [],
    invulnFrames: 0
};

// Input handling with proper debouncing
const input = {
    keys: {},
    lastMove: 0
};

// Generate maze
function generateMaze() {
    game.maze = Array.from({length: N}, () => Array(N).fill(WALL));

    function carve(x, y) {
        game.maze[y][x] = FLOOR;
        const dirs = [[0,-2],[2,0],[0,2],[-2,0]].sort(() => Math.random() - 0.5);
        for (const [dx, dy] of dirs) {
            const nx = x + dx, ny = y + dy;
            if (nx > 0 && nx < N-1 && ny > 0 && ny < N-1 && game.maze[ny][nx] === WALL) {
                game.maze[y + dy/2][x + dx/2] = FLOOR;
                carve(nx, ny);
            }
        }
    }

    carve(1, 1);
    game.maze[N-2][N-2] = FLOOR;

    // Widen some corridors for better gameplay
    for (let i = 0; i < 30; i++) {
        const x = Math.floor(Math.random() * (N-2)) + 1;
        const y = Math.floor(Math.random() * (N-2)) + 1;
        if (game.maze[y][x] === WALL) {
            let floorNeighbors = 0;
            [[0,1],[1,0],[0,-1],[-1,0]].forEach(([dx,dy]) => {
                if (game.maze[y+dy]?.[x+dx] === FLOOR) floorNeighbors++;
            });
            if (floorNeighbors >= 2) game.maze[y][x] = FLOOR;
        }
    }
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

    // Place 3 keys scattered around the maze
    game.keys = [];
    for (let i = 0; i < 3; i++) {
        let pos;
        do {
            pos = floors[Math.floor(Math.random() * floors.length)];
        } while (game.keys.some(k => k.x === pos.x && k.y === pos.y) || 
                 (pos.x < 5 && pos.y < 5) || // not near start
                 (pos.x > N-5 && pos.y > N-5)); // not near exit
        
        game.keys.push({...pos, collected: false});
    }

    // Place 2-3 safe zones
    game.safeZones = [];
    for (let i = 0; i < 3; i++) {
        const center = floors[Math.floor(Math.random() * floors.length)];
        if (center.x < 5 && center.y < 5) continue; // not near start
        
        // Create 2x2 safe zone
        for (let dy = 0; dy < 2; dy++) {
            for (let dx = 0; dx < 2; dx++) {
                const sx = center.x + dx, sy = center.y + dy;
                if (sx < N && sy < N && game.maze[sy][sx] === FLOOR) {
                    game.safeZones.push({x: sx, y: sy});
                    game.maze[sy][sx] = SAFE;
                }
            }
        }
    }

    // Place monster far from player
    let monsterPos = {x: N-3, y: 1};
    game.monster = {
        x: monsterPos.x,
        y: monsterPos.y,
        cooldown: 0,
        speed: 8 // moves every 8 frames
    };

    game.playerTrail = [];
}

// Initialize game
function init() {
    generateMaze();
    game.player = {x: 1, y: 1};
    game.keysCollected = 0;
    game.gameOver = false;
    game.won = false;
    game.deaths = 0;
    game.startTime = Date.now();
    game.invulnFrames = 0;
    placeElements();
    updateHUD();
}

// Check if position is walkable
function isWalkable(x, y, isMonster = false) {
    if (x < 0 || x >= N || y < 0 || y >= N) return false;
    const tile = game.maze[y][x];
    if (tile === WALL) return false;
    // If monster, it must not enter safe zones
    if (isMonster && tile === SAFE) return false;
    // Doors are not walkable by player (unless you want keys/unlock logic)
    if (!isMonster && tile === DOOR) return false;
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

// Monster AI - follows player trail with some intelligence
function updateMonster() {
    if (!game.monster) return;
    // record previous position for swap detection
    game.prevMonster = { x: game.monster.x, y: game.monster.y };

    if (game.monster.cooldown > 0) {
        game.monster.cooldown--;
        return;
    }

    // choose target (scent / recent trail or player)
    let target = game.player;
    if (game.playerTrail && game.playerTrail.length > 5) {
        target = game.playerTrail[0]; // follow most recent trail point
    }

    const path = findPath(game.monster, target, true);
    if (path && path.length > 0) {
        const step = path[0];
        game.monster.x = step.x;
        game.monster.y = step.y;
    }

    game.monster.cooldown = game.monster.speed;

    // collision handled after both moves (see update())
}

// Handle player movement
function movePlayer(dx, dy) {
    const now = Date.now();
    if (now - game.lastMoveTime < game.moveDelay) return; // debounce: stop extra moves
    game.lastMoveTime = now;

    const newX = game.player.x + dx;
    const newY = game.player.y + dy;

    if (!isWalkable(newX, newY, false)) return;

    // commit move
    game.prevPlayer = { x: game.player.x, y: game.player.y }; // track previous for collision checks
    game.player.x = newX;
    game.player.y = newY;

    // update trail & interactions
    game.playerTrail.unshift({ x: newX, y: newY });
    if (game.playerTrail.length > 50) game.playerTrail.pop();

    // key pickup, switches, spikes, etc. (ensure those handlers exist)
    handleTileEnter(newX, newY);
}

// Check collision with monster
function checkCollision() {
    if (game.invulnFrames > 0) {
        game.invulnFrames--;
        return;
    }

    if (game.player.x === game.monster.x && game.player.y === game.monster.y) {
        game.deaths++;
        updateHUD();
        respawnPlayer();
    }
}

// Respawn player at start with brief invulnerability
function respawnPlayer() {
    game.player.x = 1;
    game.player.y = 1;
    game.invulnFrames = 30; // 0.5 second immunity
    game.playerTrail = [];
}

// Update HUD
function updateHUD() {
    document.getElementById('keyCount').textContent = game.keysCollected;
    document.getElementById('deathCount').textContent = game.deaths;
    const elapsed = Math.floor((Date.now() - game.startTime) / 1000);
    document.getElementById('timeCount').textContent = elapsed;
}

// Game loop
let frameCount = 0;
function gameLoop() {
    if (!game.gameOver && !game.won) {
        // Handle input
        if (input.keys['ArrowUp'] || input.keys['w'] || input.keys['W']) movePlayer(0, -1);
        if (input.keys['ArrowDown'] || input.keys['s'] || input.keys['S']) movePlayer(0, 1);
        if (input.keys['ArrowLeft'] || input.keys['a'] || input.keys['A']) movePlayer(-1, 0);
        if (input.keys['ArrowRight'] || input.keys['d'] || input.keys['D']) movePlayer(1, 0);

        // Update monster
        frameCount++;
        if (frameCount % 2 === 0) updateMonster();

        updateHUD();
    }

    draw();
    requestAnimationFrame(gameLoop);
}

// Draw game
function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw maze
    for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
            const tile = game.maze[y][x];
            const px = x * TILE_SIZE, py = y * TILE_SIZE;

            if (tile === WALL) {
                ctx.fillStyle = "#2d3561";
                ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
                ctx.strokeStyle = "#1a1f3a";
                ctx.strokeRect(px, py, TILE_SIZE, TILE_SIZE);
            } else if (tile === SAFE) {
                ctx.fillStyle = "#1a4d2e";
                ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
                ctx.fillStyle = "#2d8659";
                ctx.fillRect(px + 3, py + 3, TILE_SIZE - 6, TILE_SIZE - 6);
            } else {
                ctx.fillStyle = "#0f0f1e";
                ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
                ctx.strokeStyle = "#1a1a2e";
                ctx.strokeRect(px, py, TILE_SIZE, TILE_SIZE);
            }
        }
    }

    // Draw player trail (fading)
    for (let i = 0; i < game.playerTrail.length; i++) {
        const pos = game.playerTrail[i];
        const alpha = (i / game.playerTrail.length) * 0.3;
        ctx.fillStyle = `rgba(0, 255, 255, ${alpha})`;
        ctx.fillRect(pos.x * TILE_SIZE + 10, pos.y * TILE_SIZE + 10, 10, 10);
    }

    // Draw keys
    for (const key of game.keys) {
        if (!key.collected) {
            ctx.fillStyle = "#ffd700";
            ctx.beginPath();
            ctx.arc(key.x * TILE_SIZE + TILE_SIZE/2, key.y * TILE_SIZE + TILE_SIZE/2, 8, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = "#ffed4e";
            ctx.lineWidth = 2;
            ctx.stroke();
        }
    }

    // Draw exit
    const exitColor = game.keysCollected === 3 ? "#00ff00" : "#ff4444";
    ctx.fillStyle = exitColor;
    ctx.fillRect(game.exit.x * TILE_SIZE + 5, game.exit.y * TILE_SIZE + 5, TILE_SIZE - 10, TILE_SIZE - 10);
    ctx.strokeStyle = game.keysCollected === 3 ? "#00aa00" : "#aa0000";
    ctx.lineWidth = 3;
    ctx.strokeRect(game.exit.x * TILE_SIZE + 5, game.exit.y * TILE_SIZE + 5, TILE_SIZE - 10, TILE_SIZE - 10);

    // Draw player
    const playerFlash = game.invulnFrames > 0 && frameCount % 4 < 2;
    if (!playerFlash) {
        ctx.fillStyle = "#00ffff";
        ctx.beginPath();
        ctx.arc(game.player.x * TILE_SIZE + TILE_SIZE/2, 
               game.player.y * TILE_SIZE + TILE_SIZE/2, 
               TILE_SIZE/3, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#00aaaa";
        ctx.lineWidth = 2;
        ctx.stroke();
    }

    // Draw monster
    ctx.fillStyle = "#ff0000";
    ctx.fillRect(game.monster.x * TILE_SIZE + 6, game.monster.y * TILE_SIZE + 6, 
                TILE_SIZE - 12, TILE_SIZE - 12);
    ctx.strokeStyle = "#aa0000";
    ctx.lineWidth = 2;
    ctx.strokeRect(game.monster.x * TILE_SIZE + 6, game.monster.y * TILE_SIZE + 6, 
                  TILE_SIZE - 12, TILE_SIZE - 12);

    // Draw game over / win screens
    if (game.won) {
        ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        ctx.fillStyle = "#00ff00";
        ctx.font = "bold 48px Arial";
        ctx.textAlign = "center";
        ctx.fillText("YOU ESCAPED!", canvas.width/2, canvas.height/2 - 20);
        
        ctx.fillStyle = "#ffffff";
        ctx.font = "20px Arial";
        const time = Math.floor((Date.now() - game.startTime) / 1000);
        ctx.fillText(`Time: ${time}s | Deaths: ${game.deaths}`, canvas.width/2, canvas.height/2 + 30);
        ctx.fillText("Press R to restart", canvas.width/2, canvas.height/2 + 70);
    }
}

// Input handlers
document.addEventListener('keydown', (e) => {
    input.keys[e.key] = true;
    
    if (e.key === 'r' || e.key === 'R') {
        init();
    }
});

document.addEventListener('keyup', (e) => {
    input.keys[e.key] = false;
});

// Start game
init();
gameLoop();