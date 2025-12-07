const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

const TILE_SIZE = 30;  // each tile is 30x30 pixels
const N = 21;          // odd-size maze (walls on edges)

// Tile types
const FLOOR = 0;
const WALL = 1;
const SPIKE = 2;
const DOOR = 3;    // closed door
const SWITCH = 4;
const ROTBLOCK = 5;
const SAFE = 6;      // safe zone (visual + monster can't enter)

// Game state
const game = {
    maze: [],
    player: { x: 1, y: 1 },
    switches: [],
    rotblocks: [],
    monster: null,
    playerVisited: [],
    gameOver: false,
    won: false,
    keys: {},
    frameCount: 0,
    monsterLearningLevel: 1,
    respawn: null,        // respawn location
    safeZones: [],        // list of safe tile coords (monster can't enter)
    invulnFrames: 0       // short invulnerability after respawn
};

// Initialize game
function init() {
    generateMaze();
    game.player = { x: 1, y: 1 };
    game.gameOver = false;
    game.won = false;
    game.frameCount = 0;
    game.switches = [];
    game.rotblocks = [];                 // reset rotblocks
    game.playerVisited = [];
    game.prevPlayer = null;              // track for swap/crossing detection
    game.prevMonster = null;
    for (let y = 0; y < N; y++) {
        game.playerVisited[y] = [];
        for (let x = 0; x < N; x++) game.playerVisited[y][x] = 0;
    }

    placeFeatures();   // doors, spikes, rotblocks, switches
    placeMonster();
}

// Maze generation using recursive backtracking (odd cell maze)
function generateMaze() {
    game.maze = [];
    for (let y = 0; y < N; y++) {
        game.maze[y] = [];
        for (let x = 0; x < N; x++) {
            game.maze[y][x] = WALL; // walls
        }
    }

    function carve(x, y) {
        game.maze[y][x] = FLOOR;
        const dirs = [[0,-2],[2,0],[0,2],[-2,0]].sort(()=>Math.random()-0.5);
        for (const [dx,dy] of dirs) {
            const nx = x+dx, ny = y+dy;
            if (nx > 0 && nx < N-1 && ny > 0 && ny < N-1 && game.maze[ny][nx] === WALL) {
                game.maze[y + dy/2][x + dx/2] = FLOOR;
                carve(nx, ny);
            }
        }
    }

    carve(1,1);
    // Ensure exit
    game.maze[N-2][N-2] = FLOOR;
}

// place doors, spikes, rotblocks, and switches
function placeFeatures() {
    // place a few doors (closed), spikes corridors, rotblocks, and switches linked to effects
    const candidates = [];
    for (let y = 1; y < N-1; y++) for (let x = 1; x < N-1; x++)
        if (game.maze[y][x] === FLOOR) candidates.push({x,y});

    // place 1 door near exit corridor
    const doorPos = candidates[Math.floor(Math.random()*candidates.length)];
    game.maze[doorPos.y][doorPos.x] = DOOR;

    // place a few spikes (off by default).
    const spikePositions = [];
    for (let i=0;i<6;i++){
        const p = candidates[Math.floor(Math.random()*candidates.length)];
        if (game.maze[p.y][p.x] === FLOOR) {
            game.maze[p.y][p.x] = SPIKE;
            spikePositions.push(p);
        }
    }

    // place a few rotblocks (2x2 blocks that can be rotated)
    // store rotblocks in game.rotblocks as {x,y,tiles:[[a,b],[c,d]]}
    for (let i=0;i<3;i++){
        const p = candidates[Math.floor(Math.random()*candidates.length)];
        if (p.x < N-2 && p.y < N-2) {
            // capture the current 2x2 tile types (or create a small pattern if walls)
            const tx = p.x, ty = p.y;
            const a = game.maze[ty][tx] === WALL ? FLOOR : game.maze[ty][tx];
            const b = game.maze[ty][tx+1] === WALL ? WALL : game.maze[ty][tx+1];
            const c = game.maze[ty+1][tx] === WALL ? WALL : game.maze[ty+1][tx];
            const d = game.maze[ty+1][tx+1] === WALL ? FLOOR : game.maze[ty+1][tx+1];
            const tiles = [[a,b],[c,d]];
            game.rotblocks.push({x:tx, y:ty, tiles});
            // write tiles back and mark anchor cell visually as ROTBLOCK
            game.maze[ty][tx] = ROTBLOCK;          // anchor visible as R
            game.maze[ty][tx+1] = tiles[0][1];
            game.maze[ty+1][tx] = tiles[1][0];
            game.maze[ty+1][tx+1] = tiles[1][1];
        }
    }

    // Place switches - each switch gets a type and target
    const switchTypes = ['rotate','door','spikes','reroute'];
    for (let i=0;i<4;i++){
        let p = candidates[Math.floor(Math.random()*candidates.length)];
        // ensure not overriding door/spike/rotblock anchor (and also avoid non-floor)
        if (!p || game.maze[p.y][p.x] !== FLOOR) {
            i--; continue;
        }
        const type = switchTypes[i % switchTypes.length];
        const sw = { x: p.x, y: p.y, type, active: false };
        // link rotblock or door/spikes as needed
        if (type === 'rotate') {
            // pick a rotblock from game.rotblocks
            if (game.rotblocks.length > 0) sw.target = game.rotblocks[i % game.rotblocks.length];
            else { i--; continue; }
        }
        if (type === 'door') sw.target = doorPos;
        if (type === 'spikes') sw.targets = spikePositions;
        game.switches.push(sw);
        game.maze[p.y][p.x] = SWITCH;
    }

    // pick a respawn tile near start (not too close to exit)
    const startCandidates = candidates.filter(p => !(p.x === (N-2) && p.y === (N-2)) && !(p.x === game.player.x && p.y === game.player.y));
    const resp = startCandidates[Math.floor(Math.random() * startCandidates.length)] || { x: 1, y: 1 };
    game.respawn = { x: resp.x, y: resp.y };

    // create a small safe zone (3x3) around respawn where monster won't enter
    game.safeZones = [];
    for (let sy = -1; sy <= 1; sy++) {
        for (let sx = -1; sx <= 1; sx++) {
            const rx = resp.x + sx, ry = resp.y + sy;
            if (rx > 0 && rx < N-1 && ry > 0 && ry < N-1 && game.maze[ry][rx] !== WALL) {
                game.safeZones.push({ x: rx, y: ry });
                game.maze[ry][rx] = SAFE;
            }
        }
    }

    // Ensure the door does not permanently block the only path to the exit:
    if (!isReachable({x: game.player.x, y: game.player.y}, {x: N-2, y: N-2})) {
        // If the maze is blocked with the closed door, open it (convert to FLOOR)
        if (doorPos && game.maze[doorPos.y][doorPos.x] === DOOR) {
            game.maze[doorPos.y][doorPos.x] = FLOOR;
        }
    }

    // spike state map (true = spikes active)
    game.spikesOn = false;
}

// Rotate a 2x2 block anchored at tx,ty clockwise (if within bounds)
// Now operates on a rotblock object (reads/writes its tiles and the maze)
function rotate2x2(tx, ty) {
    // find rotblock by anchor
    const rb = game.rotblocks.find(r => r.x === tx && r.y === ty);
    if (!rb) return;
    const t = rb.tiles;
    // rotate clockwise: new = [[c,a],[d,b]]
    const newTiles = [
        [t[1][0], t[0][0]],
        [t[1][1], t[0][1]]
    ];
    rb.tiles = newTiles;
    // write back to maze: keep anchor cell as ROTBLOCK for visibility
    game.maze[ty][tx] = ROTBLOCK;
    game.maze[ty][tx+1] = newTiles[0][1];
    game.maze[ty+1][tx] = newTiles[1][0];
    game.maze[ty+1][tx+1] = newTiles[1][1];
}

// Simple reroute: carve a short corridor from random wall near switch
function rerouteNear(sx, sy) {
    const directionCandidates = [[0,-1],[1,0],[0,1],[-1,0]];
    for (const [dx,dy] of directionCandidates) {
        const x = sx + dx*2, y = sy + dy*2;
        if (x>0 && x<N-1 && y>0 && y<N-1 && game.maze[y][x] === WALL) {
            game.maze[sy+dy][sx+dx] = FLOOR;
            game.maze[y][x] = FLOOR;
            return;
        }
    }
}

// place monster and memory grid
function placeMonster() {
    // find a floor tile far from player
    let mpos = {x: N-2, y: 1};
    game.monster = {
        x: mpos.x,
        y: mpos.y,
        moveCooldown: 0,
        baseCooldownFrames: 40, // lower = faster
        learningFactor: 1.0
    };
}

// Game loop
function gameLoop() {
    update();
    draw();
    requestAnimationFrame(gameLoop);
}

function update() {
    if (game.gameOver || game.won) return;
    game.frameCount++;

    if (game.invulnFrames > 0) game.invulnFrames--;

    // record previous player position for crossing/swap detection
    game.prevPlayer = { x: game.player.x, y: game.player.y };

    // Handle player movement (single-tile per keypress)
    let newX = game.player.x;
    let newY = game.player.y;

    if (game.keys['ArrowUp'] || game.keys['w'] || game.keys['W']) newY--;
    if (game.keys['ArrowDown'] || game.keys['s'] || game.keys['S']) newY++;
    if (game.keys['ArrowLeft'] || game.keys['a'] || game.keys['A']) newX--;
    if (game.keys['ArrowRight'] || game.keys['d'] || game.keys['D']) newX++;

    if (isWalkable(newX, newY)) {
        game.player.x = newX;
        game.player.y = newY;

        // mark visited for monster learning
        game.playerVisited[newY][newX] = (game.playerVisited[newY][newX] || 0) + 1;

        // stepping on switch?
        const sw = game.switches.find(s => s.x === newX && s.y === newY);
        if (sw && !sw.active) {
            activateSwitch(sw);
        }

        // stepping on spike kills player if spikes are active
        if (game.maze[newY][newX] === SPIKE && game.spikesOn) {
            onPlayerDeath();
            return;
        }
    }

    // Check win condition (reach exit)
    if (game.player.x === N - 2 && game.player.y === N - 2) {
        game.won = true;
    }

    // Update monster (moves toward the most-visited tiles / learns player paths)
    updateMonster();

    // Collision detection after both moves:
    if (game.monster) {
        if (game.invulnFrames <= 0) {
            // direct collision
            if (game.player.x === game.monster.x && game.player.y === game.monster.y) {
                onPlayerDeath();
                return;
            }
            // crossing / swap detection
            if (game.prevPlayer && game.prevMonster) {
                const swapped = game.player.x === game.prevMonster.x && game.player.y === game.prevMonster.y
                             && game.monster.x === game.prevPlayer.x && game.monster.y === game.prevPlayer.y;
                if (swapped) { onPlayerDeath(); return; }
            }
            if (game.prevMonster && game.player.x === game.prevMonster.x && game.player.y === game.prevMonster.y) {
                onPlayerDeath(); return;
            }
        }
    }
}

// isWalkable for player (doors closed are not walkable; spikes are walkable but may kill)
function isWalkable(x, y) {
    if (x < 0 || x >= N || y < 0 || y >= N) return false;
    const t = game.maze[y][x];
    if (t === WALL) return false;
    if (t === DOOR) return false;
    // SAFE is walkable for player
    return true;
}

// Monster BFS and movement: treat SAFE as blocked for monster
function monsterNextStepTowards(tx, ty) {
    const q = [];
    const visited = Array.from({length:N}, ()=>Array(N).fill(false));
    const parent = Array.from({length:N}, ()=>Array(N).fill(null));
    q.push({x: game.monster.x, y: game.monster.y});
    visited[game.monster.y][game.monster.x] = true;

    const dirs = [[0,-1],[1,0],[0,1],[-1,0]];
    while(q.length){
        const cur = q.shift();
        if (cur.x === tx && cur.y === ty) break;
        for (const [dx,dy] of dirs) {
            const nx = cur.x+dx, ny = cur.y+dy;
            if (nx<0||nx>=N||ny<0||ny>=N) continue;
            if (visited[ny][nx]) continue;
            const tile = game.maze[ny][nx];
            // monster cannot enter WALL, DOOR or SAFE
            if (tile === WALL || tile === DOOR || tile === SAFE) continue;
            visited[ny][nx]=true;
            parent[ny][nx] = cur;
            q.push({x:nx,y:ny});
        }
    }

    if (!visited[ty][tx]) return null;
    let cur = {x: tx, y: ty};
    while(parent[cur.y][cur.x] && !(parent[cur.y][cur.x].x === game.monster.x && parent[cur.y][cur.x].y === game.monster.y)) {
        cur = parent[cur.y][cur.x];
    }
    return cur;
}

function updateMonster() {
    const m = game.monster;
    if (!m) return;
    // record previous monster position for swap detection
    game.prevMonster = { x: m.x, y: m.y };

    if (m.moveCooldown > 0) { m.moveCooldown--; return; }

    // determine target based on learned heat
    const target = findMonsterTarget();
    const next = monsterNextStepTowards(target.x, target.y) || monsterNextStepTowards(game.player.x, game.player.y);

    if (next) {
        m.x = next.x;
        m.y = next.y;
    } else {
        // random small patrol if no path
        const dirs = [[0,-1],[1,0],[0,1],[-1,0]].sort(()=>Math.random()-0.5);
        for (const [dx,dy] of dirs) {
            const nx = m.x+dx, ny = m.y+dy;
            if (nx>0 && nx<N-1 && ny>0 && ny<N-1 && game.maze[ny][nx] !== WALL && game.maze[ny][nx] !== DOOR) {
                m.x = nx; m.y = ny; break;
            }
        }
    }

    // collision with player? (also handled after update)
    if (m.x === game.player.x && m.y === game.player.y) {
        onPlayerDeath();
        return;
    }

    // set cooldown frames influenced by learning level (monster gets faster as it learns)
    const speedFactor = Math.max(0.3, 1 - 0.1 * (game.monsterLearningLevel-1));
    m.moveCooldown = Math.floor(m.baseCooldownFrames * speedFactor);
}

function onPlayerDeath() {
    // increment monster learning but respawn player instead of full game over
    game.monsterLearningLevel = Math.min(10, game.monsterLearningLevel + 1);

    // respawn at respawn point (if exists), give short invulnerability
    if (game.respawn) {
        game.player.x = game.respawn.x;
        game.player.y = game.respawn.y;
        game.invulnFrames = 60; // ~1 second at 60fps
        return;
    }

    // fallback to game over
    game.gameOver = true;
}

// Drawing
function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw maze tiles
    for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
            const t = game.maze[y][x];
            const px = x * TILE_SIZE, py = y * TILE_SIZE;
            // base floor
            if (t === WALL) {
                ctx.fillStyle = "#444";
                ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
            } else {
                ctx.fillStyle = "#222";
                ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
            }

            // overlays / icons
            ctx.font = `${TILE_SIZE - 8}px serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            if (t === SPIKE) {
                ctx.fillStyle = game.spikesOn ? "#a00" : "#553";
                ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
                ctx.fillStyle = "#fff";
                ctx.fillText("⚠️", px + TILE_SIZE/2, py + TILE_SIZE/2);
            } else if (t === DOOR) {
                ctx.fillStyle = "#7a3";
                ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
                ctx.fillStyle = "#000";
                ctx.fillText("🔒", px + TILE_SIZE/2, py + TILE_SIZE/2);
            } else if (t === SWITCH) {
                ctx.fillStyle = "#0af";
                ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
                ctx.fillStyle = "#000";
                ctx.fillText("🔘", px + TILE_SIZE/2, py + TILE_SIZE/2);
            } else if (t === ROTBLOCK) {
                ctx.fillStyle = "#b68";
                ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
                ctx.fillStyle = "#000";
                ctx.fillText("🔁", px + TILE_SIZE/2, py + TILE_SIZE/2);
            } else if (t === SAFE) {
                ctx.fillStyle = "#2d6";
                ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
                ctx.fillStyle = "#000";
                ctx.fillText("🛡️", px + TILE_SIZE/2, py + TILE_SIZE/2);
            }

            ctx.strokeStyle = "#111";
            ctx.strokeRect(px, py, TILE_SIZE, TILE_SIZE);
        }
    }

    // draw switches with active state (small overlay)
    for (const sw of game.switches) {
        ctx.fillStyle = sw.active ? "#ff0" : "#0ff";
        ctx.fillRect(sw.x * TILE_SIZE + 6, sw.y * TILE_SIZE + 6, TILE_SIZE - 12, TILE_SIZE - 12);
    }

    // Draw respawn icon
    if (game.respawn) {
        ctx.fillStyle = "#fff";
        ctx.font = `${TILE_SIZE - 12}px serif`;
        ctx.fillText("🔁", game.respawn.x * TILE_SIZE + TILE_SIZE/2, game.respawn.y * TILE_SIZE + TILE_SIZE/2);
    }

    // Draw exit
    ctx.fillStyle = "#0f0";
    ctx.fillRect((N - 2) * TILE_SIZE + 5, (N - 2) * TILE_SIZE + 5, TILE_SIZE - 10, TILE_SIZE - 10);
    ctx.fillStyle = "#000";
    ctx.fillText("⛳", (N - 2) * TILE_SIZE + TILE_SIZE/2, (N - 2) * TILE_SIZE + TILE_SIZE/2);

    // Draw player (invulnerable flash)
    ctx.fillStyle = game.invulnFrames > 0 ? "#88ffff" : "#0ff";
    ctx.beginPath();
    ctx.arc(game.player.x * TILE_SIZE + TILE_SIZE / 2, game.player.y * TILE_SIZE + TILE_SIZE / 2, TILE_SIZE / 3, 0, Math.PI * 2);
    ctx.fill();

    // Draw monster (red)
    if (game.monster) {
        ctx.fillStyle = "#f00";
        ctx.fillRect(game.monster.x * TILE_SIZE + 4, game.monster.y * TILE_SIZE + 4, TILE_SIZE - 8, TILE_SIZE - 8);
    }

    // HUD (short)
    ctx.fillStyle = "#fff";
    ctx.font = "bold 14px Arial";
    ctx.textAlign = "left";
    ctx.fillText("Spikes: " + (game.spikesOn ? "ON" : "OFF") + "   Monster level: " + game.monsterLearningLevel, 10, 18);

    if (game.gameOver) {
        ctx.fillStyle = "#f00";
        ctx.font = "bold 32px Arial";
        ctx.textAlign = "center";
        ctx.fillText("YOU DIED", canvas.width / 2, canvas.height / 2);
        ctx.font = "16px Arial";
        ctx.fillText("Press R to restart", canvas.width / 2, canvas.height / 2 + 40);
    } else if (game.won) {
        ctx.fillStyle = "#0f0";
        ctx.font = "bold 32px Arial";
        ctx.textAlign = "center";
        ctx.fillText("YOU WON!", canvas.width / 2, canvas.height / 2);
        ctx.font = "16px Arial";
        ctx.fillText("Press R to restart", canvas.width / 2, canvas.height / 2 + 40);
    }
}

// Keyboard controls
document.addEventListener("keydown", (e) => {
    game.keys[e.key] = true;

    if (e.key === 'r' || e.key === 'R') {
        init();
    }
});

document.addEventListener("keyup", (e) => {
    game.keys[e.key] = false;
});

// Start the game
init();
gameLoop();
