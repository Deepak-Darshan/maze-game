# Maze Chase 🎮

A thrilling 2D maze escape game where you play as an angel trying to collect keys and escape before the monster catches you!

## 🎯 Game Overview

**Maze Chase** is an interactive browser-based maze game built with HTML5 Canvas and JavaScript. Navigate through procedurally generated mazes, collect keys, avoid the monster, and escape to victory!

## ✨ Features

### Core Gameplay
- **Procedural Maze Generation**: Each level features a unique randomly generated 21×21 maze
- **Key Collection**: Collect all 3 glowing star keys to unlock the exit door
- **Monster AI**: Intelligent monster that uses pathfinding to chase you and speeds up when following your trail
- **Safe Zones**: Green areas that provide temporary safety (but monsters can break them if you stay too long!)
- **Checkpoints**: Golden rings that save your progress - respawn at the last checkpoint when you die
- **Bomb Mechanic**: Collect bombs and strategically break walls to create new paths
- **Power-ups**: Speed boosts to help you escape faster
- **Spikes**: Dangerous red tiles that damage you - avoid them!

### Visual Features
- **Beautiful Graphics**: Custom-drawn sprites including:
  - Angel player character with halo and flapping wings
  - Red monster with glowing eyes and rotating spikes
  - Glowing rotating star keys
  - Detailed wooden exit door (opens when all keys collected)
  - Animated bomb explosions with countdown
  - Wall-breaking animations
- **Smooth Animations**: All game elements feature fluid animations
- **HUD Display**: Real-time stats including keys collected, deaths, time, and monster speed
- **Maze Legend**: Visual guide showing all game elements

### Game Controls
- **Movement**: `WASD` or `Arrow Keys` to move
- **Place Bomb**: `Space` (when you have a bomb)
- **Reset Level**: Click the Reset button (↻) to restore the current level to its initial state
- **Skip Level**: Click the Skip button to generate a new level
- **Restart**: Press `R` to restart the game

## 🎮 How to Play

1. **Objective**: Collect all 3 keys and reach the exit door before the monster catches you
2. **Movement**: Use WASD or Arrow Keys to navigate the maze
3. **Keys**: Collect the glowing star keys scattered throughout the maze
4. **Exit Door**: Once all keys are collected, the door opens - reach it to win!
5. **Monster**: The red monster will chase you using intelligent pathfinding. It speeds up by 20% when following your trail!
6. **Safe Zones**: Green areas provide temporary safety, but don't stay too long - monsters can break them!
7. **Bombs**: Collect bomb pickups and use Space to place them. They explode after 1 second and break adjacent walls (8 tiles)
8. **Checkpoints**: Activate golden checkpoints to save your progress
9. **Strategy**: Plan your route, use safe zones wisely, and always have an escape route!

## 🛠️ Technical Details

### Technologies Used
- **HTML5 Canvas**: For rendering the game graphics
- **JavaScript (ES6+)**: Core game logic and mechanics
- **CSS3**: Styling and layout

### Game Mechanics
- **Maze Generation**: Recursive backtracking algorithm
- **Pathfinding**: BFS (Breadth-First Search) for monster AI
- **Collision Detection**: Grid-based collision system
- **State Management**: Comprehensive game state tracking
- **Animation System**: Frame-based animations with timing controls

### File Structure
```
maze-game/
├── index.html      # Main HTML file with game structure
├── game.js         # Core game logic and mechanics
├── style.css       # Styling and layout
└── README.md       # This file
```

## 🚀 Getting Started

1. **Clone or Download** the repository
2. **Open** `index.html` in a modern web browser
3. **Play** the game - no installation required!

## 🎨 Game Elements

| Element | Description |
|---------|-------------|
| **Floor** | Walkable tiles (dark blue) |
| **Wall** | Blocked tiles (purple) |
| **Safe Zone** | Green areas providing temporary safety |
| **Key (⭐)** | Glowing rotating star - collect all 3 |
| **Exit Door** | Wooden door that opens when all keys are collected |
| **Monster** | Red creature with black eyes that chases you |
| **Player (Angel)** | Your character with halo and wings |
| **Spikes** | Red tiles that damage you |
| **Bomb Pickup** | Black bomb with fuse - collect to break walls |
| **Speed Power-up (⚡)** | Blue circle that increases movement speed |

## 🏆 Game Features in Detail

### Monster AI
- Uses BFS pathfinding to find the shortest path to the player
- Increases speed by 20% when following the player's visible trail
- Can break safe zones if the player stays idle for 3+ seconds (only if it's the only way to reach the player)
- Always moving - never pauses

### Bomb System
- Only 2 bombs available per level
- Player can carry one bomb at a time
- Explodes after 1 second with beeping countdown
- Breaks walls in 8 adjacent/diagonal tiles
- Cannot break: maze boundaries, exit tile, safe zones, spikes, or monster tile
- Features explosion wave animation and wall-breaking effects

### Safe Zones
- Green areas that monsters cannot enter initially
- If player stays idle for 3+ seconds, monster can break them
- Monster must bang 4 times before breaking one square
- Only breaks if it's the ONLY way to reach the player

### Checkpoint System
- Golden rings placed throughout the maze
- Activate by walking over them
- Respawn at the last activated checkpoint when you die
- Prevents losing all progress on death

## 🎯 Tips for Success

1. **Plan Ahead**: Think about your route before moving
2. **Use Safe Zones Wisely**: Don't stay too long - monsters can break them!
3. **Strategic Bombing**: Use bombs to create escape routes or shortcuts
4. **Activate Checkpoints**: Always activate checkpoints to save progress
5. **Watch Monster Speed**: The speed indicator shows when the monster is on your trail
6. **Don't Get Cornered**: Always maintain an escape route
7. **Time Management**: Balance speed with caution

## 🔧 Customization

The game is easily customizable:
- **Maze Size**: Change `N` constant in `game.js` (currently 21×21)
- **Tile Size**: Adjust `TILE_SIZE` constant (currently 30px)
- **Monster Speed**: Modify `baseSpeed` in monster initialization
- **Game Elements**: Adjust counts in `placeElements()` function

## 📝 License

This project is open source and available for educational purposes.

## 🎮 Enjoy Playing!

Have fun escaping the maze and outsmarting the monster! Good luck! 🍀
