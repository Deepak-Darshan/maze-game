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

// Game state
const game = {
    maze: [],
    player: { x: 1, y: 1 },
    switches: [],
    monster: null,
    playerVisited: [],     // counts of visits per tile (used by monster learning)
    gameOver: false,
    won: false,
    keys: {},
    frameCount: 0,
    monsterLearningLevel: 1 // increases after each player death
};

// Initialize game
function init() {
    generateMaze();
    game.player = { x: 1, y: 1 };
    game.gameOver = false;
    game.won = false;
    game.frameCount = 0;
    game.switches = [];
    game.playerVisited = [];
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

    // place a few spikes (off by default). We'll mark spike tiles as SPIKE but a switch toggles global spikeOn map
    const spikePositions = [];
    for (let i=0;i<6;i++){
        const p = candidates[Math.floor(Math.random()*candidates.length)];
        if (game.maze[p.y][p.x] === FLOOR) {
            game.maze[p.y][p.x] = SPIKE;
            spikePositions.push(p);
        }
    }

    // place a few rotblocks (2x2 blocks that can be rotated)
    const rotblocks = [];
    for (let i=0;i<3;i++){
        const p = candidates[Math.floor(Math.random()*candidates.length)];
        if (p.x < N-2 && p.y < N-2) {
            rotblocks.push({x:p.x,y:p.y});
            // mark a center tile visually (not necessary for maze collision)
            game.maze[p.y][p.x] = ROTBLOCK;
        }
    }

    // Place switches - each switch gets a type and target
    const switchTypes = ['rotate','door','spikes','reroute'];
    for (let i=0;i<4;i++){
        let p = candidates[Math.floor(Math.random()*candidates.length)];
        // ensure not overriding door/spike/rotblock
        if (game.maze[p.y][p.x] !== FLOOR) {
            i--; continue;
        }
        const type = switchTypes[i % switchTypes.length];
        const sw = { x: p.x, y: p.y, type, active: false };
        // link rotblock or door/spikes as needed
        if (type === 'rotate') sw.target = rotblocks[i % rotblocks.length];
        if (type === 'door') sw.target = doorPos;
        if (type === 'spikes') sw.targets = spikePositions;
        game.switches.push(sw);
        game.maze[p.y][p.x] = SWITCH;
    }

    // spike state map (true = spikes active)
    game.spikesOn = false;
}

// Rotate a 2x2 block anchored at tx,ty clockwise (if within bounds)
function rotate2x2(tx, ty) {
    if (tx < 1 || ty < 1 || tx+1 >= N-1 || ty+1 >= N-1) return;
    const a = game.maze[ty][tx];
    const b = game.maze[ty][tx+1];
    const c = game.maze[ty+1][tx];
    const d = game.maze[ty+1][tx+1];
    // rotate clockwise: [c a] [d b] -> [a b] etc. We'll rotate tile types (walls/floor/spike)
    game.maze[ty][tx] = c;
    game.maze[ty][tx+1] = a;
    game.maze[ty+1][tx+1] = b;
    game.maze[ty+1][tx] = d;
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
}

function activateSwitch(sw) {
    sw.active = !sw.active; // toggle on first activation for visual
    switch(sw.type) {
        case 'rotate':
            if (sw.target) rotate2x2(sw.target.x, sw.target.y);
            break;
        case 'door':
            if (sw.target) game.maze[sw.target.y][sw.target.x] = FLOOR; // open door
            break;
        case 'spikes':
            game.spikesOn = !game.spikesOn;
            break;
        case 'reroute':
            rerouteNear(sw.x, sw.y);
            break;
    }
}

// isWalkable for player (doors closed are not walkable; spikes are walkable but may kill)
function isWalkable(x, y) {
    if (x < 0 || x >= N || y < 0 || y >= N) return false;
    const t = game.maze[y][x];
    if (t === WALL) return false;
    if (t === DOOR) return false;
    // SPIKE and other non-wall tiles are walkable (spikes may kill depending on spikesOn)
    return true;
}

// Monster pathfinding: choose target tile = highest heat (playerVisited * learning factor) and BFS towards it
function findMonsterTarget() {
    let best = null;
    let bestScore = 0;
    for (let y=0;y<N;y++){
        for (let x=0;x<N;x++){
            const heat = game.playerVisited[y][x] || 0;
            const score = heat * game.monsterLearningLevel;
            if (score > bestScore) { bestScore = score; best = {x,y}; }
        }
    }
    // fallback: chase player directly
    if (!best || bestScore === 0) return {x: game.player.x, y: game.player.y};
    return best;
}

// BFS to compute next step toward target (grid moves 4-way), monster ignores spikes (immune)
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
            if (tile === WALL || tile === DOOR) continue; // monster respects walls/doors
            visited[ny][nx]=true;
            parent[ny][nx] = cur;
            q.push({x:nx,y:ny});
        }
    }

    // backtrack from target to monster to get next step
    if (!visited[ty][tx]) return null; // unreachable
    let cur = {x: tx, y: ty};
    while(parent[cur.y][cur.x] && !(parent[cur.y][cur.x].x === game.monster.x && parent[cur.y][cur.x].y === game.monster.y)) {
        cur = parent[cur.y][cur.x];
    }
    // cur now is the next step (or the target if adjacent)
    return cur;
}

function updateMonster() {
    const m = game.monster;
    if (!m) return;
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

    // collision with player?
    if (m.x === game.player.x && m.y === game.player.y) {
        onPlayerDeath();
        return;
    }

    // set cooldown frames influenced by learning level (monster gets faster as it learns)
    const speedFactor = Math.max(0.3, 1 - 0.1 * (game.monsterLearningLevel-1));
    m.moveCooldown = Math.floor(m.baseCooldownFrames * speedFactor);
}

function onPlayerDeath() {
    game.gameOver = true;
    // monster learns: increase learning level so it weights visited tiles more and speeds up
    game.monsterLearningLevel = Math.min(10, game.monsterLearningLevel + 1);
}

// Drawing
function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw maze tiles
    for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
            const t = game.maze[y][x];
            const px = x * TILE_SIZE, py = y * TILE_SIZE;
            if (t === WALL) {
                ctx.fillStyle = "#444";
                ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
            } else if (t === FLOOR) {
                ctx.fillStyle = "#222";
                ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
            } else if (t === SPIKE) {
                ctx.fillStyle = game.spikesOn ? "#a00" : "#553";
                ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
                if (game.spikesOn) {
                    ctx.fillStyle = "#000";
                    ctx.fillRect(px+6, py+6, TILE_SIZE-12, TILE_SIZE-12);
                }
            } else if (t === DOOR) {
                ctx.fillStyle = "#7a3";
                ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
                ctx.fillStyle = "#000";
                ctx.fillText("D", px+TILE_SIZE/2-4, py+TILE_SIZE/2+6);
            } else if (t === SWITCH) {
                ctx.fillStyle = "#0af";
                ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
                ctx.fillStyle = "#000";
                ctx.fillText("S", px+TILE_SIZE/2-4, py+TILE_SIZE/2+6);
            } else if (t === ROTBLOCK) {
                ctx.fillStyle = "#b68";
                ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
                ctx.fillStyle = "#000";
                ctx.fillText("R", px+TILE_SIZE/2-4, py+TILE_SIZE/2+6);
            }
            ctx.strokeStyle = "#111";
            ctx.strokeRect(px, py, TILE_SIZE, TILE_SIZE);
        }
    }

    // draw switches with active state
    for (const sw of game.switches) {
        ctx.fillStyle = sw.active ? "#ff0" : "#0ff";
        ctx.fillRect(sw.x * TILE_SIZE + 6, sw.y * TILE_SIZE + 6, TILE_SIZE - 12, TILE_SIZE - 12);
    }

    // Draw exit
    ctx.fillStyle = "#0f0";
    ctx.fillRect((N - 2) * TILE_SIZE + 5, (N - 2) * TILE_SIZE + 5, TILE_SIZE - 10, TILE_SIZE - 10);

    // Draw player
    ctx.fillStyle = "#0ff";
    ctx.beginPath();
    ctx.arc(game.player.x * TILE_SIZE + TILE_SIZE / 2, game.player.y * TILE_SIZE + TILE_SIZE / 2, TILE_SIZE / 3, 0, Math.PI * 2);
    ctx.fill();

    // Draw monster (red)
    if (game.monster) {
        ctx.fillStyle = "#f00";
        ctx.fillRect(game.monster.x * TILE_SIZE + 4, game.monster.y * TILE_SIZE + 4, TILE_SIZE - 8, TILE_SIZE - 8);
    }

    // HUD
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
