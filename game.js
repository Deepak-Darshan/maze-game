const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

const TILE_SIZE = 30;  // each tile is 30x30 pixels
const N = 20;          // 20x20 maze

// Game state
const game = {
    maze: [],
    player: { x: 0, y: 0 },
    enemies: [],
    gameOver: false,
    won: false,
    keys: {},
    frameCount: 0
};

// Initialize game
function init() {
    generateMaze();
    game.player = { x: 1, y: 1 };
    game.gameOver = false;
    game.won = false;
    game.frameCount = 0;
    game.enemies = [];
    
    // Create moving obstacles
    createEnemies();
}

// Maze generation using recursive backtracking
function generateMaze() {
    game.maze = [];
    for (let y = 0; y < N; y++) {
        game.maze[y] = [];
        for (let x = 0; x < N; x++) {
            game.maze[y][x] = 1; // 1 = wall
        }
    }

    // Carve paths
    carvePath(1, 1);
    
    // Ensure exit is open
    game.maze[N - 2][N - 2] = 0;
}

function carvePath(x, y) {
    game.maze[y][x] = 0;
    const directions = [[0, -2], [2, 0], [0, 2], [-2, 0]].sort(() => Math.random() - 0.5);
    
    for (const [dx, dy] of directions) {
        const nx = x + dx;
        const ny = y + dy;
        
        if (nx > 0 && nx < N && ny > 0 && ny < N && game.maze[ny][nx] === 1) {
            game.maze[y + dy / 2][x + dx / 2] = 0;
            carvePath(nx, ny);
        }
    }
}

// Create moving obstacles with slower speed and synchronized timing
function createEnemies() {
    // Horizontal moving block - slower speed (0.3), longer cycle
    game.enemies.push({
        x: 5,
        y: 5,
        dirX: 1,
        dirY: 0,
        minX: 3,
        maxX: 15,
        minY: 5,
        maxY: 5,
        speed: 0.3,
        startFrame: 0  // starts immediately
    });
    
    // Vertical moving block - slower speed (0.3), offset timing
    game.enemies.push({
        x: 15,
        y: 10,
        dirX: 0,
        dirY: 1,
        minX: 15,
        maxX: 15,
        minY: 8,
        maxY: 15,
        speed: 0.3,
        startFrame: 30  // delayed start for timing window
    });
    
    // Another horizontal block - slower speed (0.25), different timing
    game.enemies.push({
        x: 10,
        y: 15,
        dirX: 1,
        dirY: 0,
        minX: 8,
        maxX: 17,
        minY: 15,
        maxY: 15,
        speed: 0.25,
        startFrame: 60  // another delayed start
    });
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
    
    // Handle player movement
    let newX = game.player.x;
    let newY = game.player.y;
    
    if (game.keys['ArrowUp'] || game.keys['w'] || game.keys['W']) newY--;
    if (game.keys['ArrowDown'] || game.keys['s'] || game.keys['S']) newY++;
    if (game.keys['ArrowLeft'] || game.keys['a'] || game.keys['A']) newX--;
    if (game.keys['ArrowRight'] || game.keys['d'] || game.keys['D']) newX++;
    
    // Check collision with walls
    if (isWalkable(newX, newY)) {
        game.player.x = newX;
        game.player.y = newY;
    }
    
    // Update enemies
    for (let enemy of game.enemies) {
        updateEnemy(enemy);
        
        // Check collision with player
        if (game.player.x === enemy.x && game.player.y === enemy.y) {
            game.gameOver = true;
        }
    }
    
    // Check win condition (reach exit)
    if (game.player.x === N - 2 && game.player.y === N - 2) {
        game.won = true;
    }
}

function updateEnemy(enemy) {
    // Only move if enough frames have passed since start
    if (game.frameCount < enemy.startFrame) {
        return;
    }
    
    let nextX = enemy.x + enemy.dirX * enemy.speed;
    let nextY = enemy.y + enemy.dirY * enemy.speed;
    
    // Check if next position is walkable (not a wall)
    if (!isWalkable(Math.round(nextX), Math.round(nextY))) {
        // Bounce off walls
        enemy.dirX *= -1;
        enemy.dirY *= -1;
        return;
    }
    
    // Bounce off boundaries
    if (nextX < enemy.minX || nextX > enemy.maxX) {
        enemy.dirX *= -1;
    }
    if (nextY < enemy.minY || nextY > enemy.maxY) {
        enemy.dirY *= -1;
    }
    
    enemy.x = nextX;
    enemy.y = nextY;
}

function isWalkable(x, y) {
    if (x < 0 || x >= N || y < 0 || y >= N) return false;
    if (game.maze[y][x] === 1) return false;
    return true;
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw maze
    for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
            if (game.maze[y][x] === 1) {
                ctx.fillStyle = "#444";
                ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
                ctx.strokeStyle = "#222";
                ctx.strokeRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
            }
        }
    }
    
    // Draw exit
    ctx.fillStyle = "#0f0";
    ctx.fillRect((N - 2) * TILE_SIZE + 5, (N - 2) * TILE_SIZE + 5, TILE_SIZE - 10, TILE_SIZE - 10);
    ctx.fillStyle = "#fff";
    ctx.font = "12px Arial";
    ctx.textAlign = "center";
    ctx.fillText("E", (N - 2) * TILE_SIZE + TILE_SIZE / 2, (N - 2) * TILE_SIZE + TILE_SIZE / 2 + 4);
    
    // Draw enemies
    ctx.fillStyle = "#f00";
    for (let enemy of game.enemies) {
        ctx.fillRect(enemy.x * TILE_SIZE + 3, enemy.y * TILE_SIZE + 3, TILE_SIZE - 6, TILE_SIZE - 6);
    }
    
    // Draw player
    ctx.fillStyle = "#0ff";
    ctx.beginPath();
    ctx.arc(game.player.x * TILE_SIZE + TILE_SIZE / 2, game.player.y * TILE_SIZE + TILE_SIZE / 2, TILE_SIZE / 3, 0, Math.PI * 2);
    ctx.fill();
    
    // Draw game state messages
    ctx.fillStyle = "#fff";
    ctx.font = "bold 16px Arial";
    ctx.textAlign = "left";
    
    if (game.gameOver) {
        ctx.fillStyle = "#f00";
        ctx.font = "bold 32px Arial";
        ctx.textAlign = "center";
        ctx.fillText("GAME OVER!", canvas.width / 2, canvas.height / 2);
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
