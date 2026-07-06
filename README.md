# 🪶 Golden Wing — A Flappy Bird Adventure

A premium, feature-rich Flappy Bird-style arcade game built with pure HTML5, CSS3, and vanilla JavaScript. No engines, no frameworks — just silky canvas rendering, procedural audio, and a beautifully polished UI.

![JavaScript](https://img.shields.io/badge/JavaScript-55.3%25-yellow)
![CSS](https://img.shields.io/badge/CSS-23.7%25-blue)
![HTML](https://img.shields.io/badge/HTML-21.0%25-orange)
![PWA](https://img.shields.io/badge/PWA-Installable-green)

## 🎮 About the Game

Golden Wing takes the timeless flap-and-dodge formula and wraps it in a premium arcade experience. Guide your golden bird through an endless gauntlet of pipes, collect coins for combo multipliers, chase daily challenges, and unlock achievements — all set against a stunning animated sky that shifts between dawn, dusk, and night.

Built entirely without game engines or external libraries, every system — physics, rendering, audio, particles — is handcrafted from scratch.

## ✨ Features

### Core Gameplay
- Classic flap-and-dodge mechanics with tight, responsive physics
- Progressive difficulty — pipe gaps narrow and speed increases as your score climbs
- **Coin collection** with a chain combo multiplier for bonus points
- **Daily Challenge** chip on the main menu for a fresh objective every day

### Visuals & Polish
- Animated **loading screen** with a bird flying toward a rising sun along a flight path
- **Three visual themes** — Dawn 🌅, Dusk 🌇, and Night 🌙 — each with a distinct sky palette
- **Glassmorphism UI** throughout menus, HUD panels, and overlays
- **Confetti burst** on the game-over screen when you set a new high score
- **Achievement toast** pop-ups that appear mid-run
- Live **FPS counter** and **milestone progress bar** in the HUD
- Inline SVG icon sprite system — crisp icons on every OS without emoji font inconsistencies
- Custom typography using Fredoka, Nunito, and Space Mono (Google Fonts)

### Audio
- Fully procedural sound effects via the **Web Audio API** — no audio files required
- Independent **music** and **SFX** volume sliders
- In-HUD mute toggles for both music and sound effects

### Screens & Navigation
- **Main Menu** — Start Game, How to Play, High Scores, Settings, Credits
- **How to Play** — Illustrated guide covering keyboard, mouse, touch, scoring, coins, and tips
- **High Scores** — Persistent local leaderboard of your best runs
- **Settings** — Music & SFX volume, difficulty (Easy / Medium / Hard), graphics quality (Low / High), theme, animations toggle, fullscreen toggle, and reset options
- **HUD** — Score, Best, Coins, Level, Pause, Music toggle, SFX toggle
- **Pause Menu** — Resume, Restart, or quit to Main Menu
- **Game Over** — Final Score, Best, Coins, Accuracy %, Distance (m), Pipes Cleared, Play Again, and **Share Score**

### PWA Support
- Fully installable as a **Progressive Web App** on desktop and mobile
- Complete icon set: `.ico`, `.svg`, 16×16, 32×32, 48×48, 180×180, 192×192, 512×512, Apple Touch Icon
- `manifest.json` with `theme-color: #1B2A4A`

## 🚀 Getting Started

### Prerequisites

Just a modern web browser. No installs or build tools required.

### Run Locally

```bash
git clone https://github.com/iamparrish/Golden-Wing-Flat.git
cd Golden-Wing-Flat
```

Open `index.html` in your browser and start flying!

> **Tip:** For the best experience (PWA install, fullscreen, Web Audio), serve the files over a local server:
> ```bash
> npx serve .
> # or
> python -m http.server 8080
> ```

## 🗂️ Project Structure

```
Golden-Wing-Flat/
├── index.html              # Full game — loading, menus, HUD, overlays, SVG icon sprite
├── style.css               # All styling — glassmorphism, themes, animations, responsive layout
├── script.js               # Game engine — canvas rendering, physics, audio, achievements, PWA
├── manifest.json           # PWA manifest
├── favicon.ico             # Legacy browser favicon
├── favicon.svg             # Crisp SVG favicon
├── favicon-16.png          # 16×16 PNG favicon
├── favicon-32.png          # 32×32 PNG favicon
├── favicon-48.png          # 48×48 PNG favicon
├── favicon-180.png         # 180×180 PNG favicon
├── favicon-192.png         # 192×192 PWA icon
├── favicon-512.png         # 512×512 PWA icon
├── apple-touch-icon.png    # iOS home screen icon (180×180)
├── icon-192.png            # PWA maskable icon (192×192)
└── icon-512.png            # PWA maskable icon (512×512)
```

## 🕹️ How to Play

### Controls

| Platform | Action | Input |
|----------|--------|-------|
| Keyboard | Flap up | `Space` or `↑` |
| Mouse | Flap up | Left click |
| Touch | Flap up | Tap screen |
| Any | Pause | HUD pause button |

### Objective
Glide between the pipes without hitting them or the ground. Each pipe cleared earns +1 point. Collect 🪙 coins along the way — chain them quickly for a **combo multiplier** that boosts your score.

### Pro Tips
- Small, rhythmic taps beat frantic mashing.
- Read the pipe gap early and commit to your flight line before you reach it — last-second corrections are the #1 cause of collisions.

## ⚙️ Settings

| Setting | Options |
|---------|---------|
| Music Volume | 0–100 |
| SFX Volume | 0–100 |
| Difficulty | Easy / Medium / Hard |
| Graphics Quality | Low / High |
| Theme | Dawn / Dusk / Night |
| Animations | On / Off |
| Fullscreen | On / Off |

## 🛠️ Built With

- **HTML5** — Game structure, SVG icon sprite, all screens and overlays
- **CSS3** — Glassmorphism, theme variables, keyframe animations, responsive layout
- **Vanilla JavaScript** — Canvas rendering, physics engine, Web Audio synthesis, particle systems, achievement logic, daily challenge, leaderboard, PWA service worker

## 👤 Author

**Parrish Tarak**
- GitHub: [@iamparrish](https://github.com/iamparrish)
- Portfolio: [parrishtarak.vercel.app](https://parrishtarak.vercel.app/)

## 🤝 Contributing

Ideas for new themes, obstacles, power-ups, or game modes are welcome!

1. Fork the project
2. Create your feature branch (`git checkout -b feature/YourFeature`)
3. Commit your changes (`git commit -m 'Add YourFeature'`)
4. Push to the branch (`git push origin feature/YourFeature`)
5. Open a Pull Request
