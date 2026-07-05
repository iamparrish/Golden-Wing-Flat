/*
 * Golden Wing — main game file.
 * Canvas-rendered flappy bird clone, no build step, no dependencies.
 * Roughly top to bottom: helpers, save data, audio, achievements/leaderboard,
 * particles, game entities, the render/update loop, then the UI glue code.
 */

'use strict';

// small math/format helpers used all over the file
const Util = {
  clamp: (v, min, max) => Math.max(min, Math.min(max, v)),
  lerp: (a, b, t) => a + (b - a) * t,
  rand: (min, max) => Math.random() * (max - min) + min,
  randInt: (min, max) => Math.floor(Util.rand(min, max + 1)),
  choice: (arr) => arr[Math.floor(Math.random() * arr.length)],
  formatDate: (d) => {
    const dd = new Date(d);
    return dd.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' +
      dd.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  },
  dayString: () => new Date().toISOString().slice(0, 10),
  // Simple deterministic hash so the "daily" challenge is stable for a given date string
  seedFromString: (str) => {
    let h = 0;
    for (let i = 0; i < str.length; i++) { h = (h << 5) - h + str.charCodeAt(i); h |= 0; }
    return Math.abs(h);
  }
};

// everything we persist to localStorage lives under these keys
const StorageKeys = {
  BEST_SCORE: 'gw_best_score',
  TOTAL_COINS: 'gw_total_coins',
  GAMES_PLAYED: 'gw_games_played',
  SETTINGS: 'gw_settings',
  ACHIEVEMENTS: 'gw_achievements',
  LEADERBOARD: 'gw_leaderboard',
  DAILY: 'gw_daily_challenge',
  STATS: 'gw_stats'
};

const Store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (e) {
      console.warn('Storage read failed for', key, e);
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.warn('Storage write failed for', key, e);
    }
  }
};

const DEFAULT_SETTINGS = {
  musicVolume: 60,
  sfxVolume: 80,
  difficulty: 'medium',
  graphics: 'high',
  theme: 'dawn',
  animations: true,
  fullscreen: false
};

let settings = Object.assign({}, DEFAULT_SETTINGS, Store.get(StorageKeys.SETTINGS, {}));
let bestScore = Store.get(StorageKeys.BEST_SCORE, 0);
let totalCoins = Store.get(StorageKeys.TOTAL_COINS, 0);
let gamesPlayed = Store.get(StorageKeys.GAMES_PLAYED, 0);
let unlockedAchievements = Store.get(StorageKeys.ACHIEVEMENTS, {});
let stats = Store.get(StorageKeys.STATS, { perfectRuns: 0 });

function saveSettings() { Store.set(StorageKeys.SETTINGS, settings); }
function saveBest() { Store.set(StorageKeys.BEST_SCORE, bestScore); }
function saveCoins() { Store.set(StorageKeys.TOTAL_COINS, totalCoins); }
function saveGamesPlayed() { Store.set(StorageKeys.GAMES_PLAYED, gamesPlayed); }
function saveAchievements() { Store.set(StorageKeys.ACHIEVEMENTS, unlockedAchievements); }
function saveStats() { Store.set(StorageKeys.STATS, stats); }

/*
 * 3. AUDIO ENGINE
 * Synthesized via the Web Audio API — see the note at the bottom of this
 * file ("AUDIO NOTE") for why, and how to swap in real recorded files.
 */
class AudioEngine {
  constructor() {
    this.ctx = null;
    this.masterMusicGain = null;
    this.masterSfxGain = null;
    this.musicNodes = [];
    this.musicTimer = null;
    this.musicEnabled = true;
    this.sfxEnabled = true;
    this.currentTrack = null;
  }

  ensureContext() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.masterMusicGain = this.ctx.createGain();
    this.masterSfxGain = this.ctx.createGain();
    this.masterMusicGain.connect(this.ctx.destination);
    this.masterSfxGain.connect(this.ctx.destination);
    this.updateVolumes();
  }

  updateVolumes() {
    if (!this.ctx) return;
    this.masterMusicGain.gain.value = this.musicEnabled ? (settings.musicVolume / 100) * 0.35 : 0;
    this.masterSfxGain.gain.value = this.sfxEnabled ? (settings.sfxVolume / 100) : 0;
  }

  resume() {
    this.ensureContext();
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  /* ---- one-shot sound effects, all procedurally generated ---- */
  _tone({ freq = 440, type = 'sine', dur = 0.15, gain = 0.5, glideTo = null, delay = 0 }) {
    if (!this.sfxEnabled) return;
    this.ensureContext();
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(glideTo, 1), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.masterSfxGain);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  _noiseBurst({ dur = 0.2, gain = 0.4, delay = 0, filterFreq = 2000 }) {
    if (!this.sfxEnabled) return;
    this.ensureContext();
    const t0 = this.ctx.currentTime + delay;
    const bufferSize = Math.floor(this.ctx.sampleRate * dur);
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = filterFreq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(filter).connect(g).connect(this.masterSfxGain);
    src.start(t0);
  }

  flap() { this._tone({ freq: 340, type: 'triangle', dur: 0.12, gain: 0.35, glideTo: 220 }); }
  point() { this._tone({ freq: 660, type: 'sine', dur: 0.14, gain: 0.4, glideTo: 880 }); }
  coin() {
    this._tone({ freq: 880, type: 'square', dur: 0.08, gain: 0.25 });
    this._tone({ freq: 1320, type: 'square', dur: 0.12, gain: 0.25, delay: 0.06 });
  }
  passPipe() { this._tone({ freq: 500, type: 'sine', dur: 0.1, gain: 0.25 }); }
  collision() {
    this._noiseBurst({ dur: 0.3, gain: 0.5, filterFreq: 800 });
    this._tone({ freq: 160, type: 'sawtooth', dur: 0.4, gain: 0.3, glideTo: 40 });
  }
  click() { this._tone({ freq: 520, type: 'square', dur: 0.05, gain: 0.2 }); }
  achievement() {
    [523, 659, 784, 1046].forEach((f, i) => this._tone({ freq: f, type: 'triangle', dur: 0.18, gain: 0.3, delay: i * 0.09 }));
  }
  notification() { this._tone({ freq: 720, type: 'sine', dur: 0.1, gain: 0.25 }); this._tone({ freq: 960, type: 'sine', dur: 0.1, gain: 0.2, delay: 0.08 }); }
  gameOverJingle() {
    [392, 349, 294, 220].forEach((f, i) => this._tone({ freq: f, type: 'sawtooth', dur: 0.22, gain: 0.28, delay: i * 0.12 }));
  }
  victoryJingle() {
    [523, 659, 784, 1046, 1318].forEach((f, i) => this._tone({ freq: f, type: 'triangle', dur: 0.2, gain: 0.32, delay: i * 0.1 }));
  }

  /* ---- ambient generative music loops (menu / gameplay) ---- */
  playMusic(track) {
    if (this.currentTrack === track) return;
    this.stopMusic();
    this.currentTrack = track;
    if (!this.musicEnabled) return;
    this.ensureContext();
    const notesByTrack = {
      menu: [392, 440, 523, 440, 349, 392, 440, 523],
      gameplay: [330, 392, 440, 392, 330, 294, 330, 392]
    };
    const notes = notesByTrack[track] || notesByTrack.menu;
    let step = 0;
    const playStep = () => {
      if (this.currentTrack !== track) return;
      const t0 = this.ctx.currentTime;
      const freq = notes[step % notes.length];
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq / 2;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.5, t0 + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.9);
      osc.connect(g).connect(this.masterMusicGain);
      osc.start(t0);
      osc.stop(t0 + 1);
      step++;
      this.musicTimer = setTimeout(playStep, 480);
    };
    playStep();
  }
  stopMusic() {
    this.currentTrack = null;
    if (this.musicTimer) clearTimeout(this.musicTimer);
  }
  setMusicEnabled(v) {
    this.musicEnabled = v;
    this.updateVolumes();
    if (!v) this.stopMusic();
  }
  setSfxEnabled(v) { this.sfxEnabled = v; this.updateVolumes(); }
}
const Audio_ = new AudioEngine();

// achievements + the daily challenge
const ACHIEVEMENT_DEFS = [
  { id: 'first_flight', name: 'First Flight', check: (s) => s.gamesPlayedTotal >= 1 },
  { id: 'score_10', name: 'Score 10', check: (s) => s.score >= 10 },
  { id: 'score_25', name: 'Score 25', check: (s) => s.score >= 25 },
  { id: 'score_50', name: 'Score 50', check: (s) => s.score >= 50 },
  { id: 'coins_100', name: 'Collect 100 Coins', check: (s) => s.totalCoins >= 100 },
  { id: 'play_10', name: 'Play 10 Games', check: (s) => s.gamesPlayedTotal >= 10 },
  { id: 'perfect_run', name: 'Perfect Run', check: (s) => s.perfectRun === true },
  { id: 'high_flyer', name: 'High Flyer', check: (s) => s.score >= 75 }
];

function checkAchievements(context) {
  ACHIEVEMENT_DEFS.forEach((def) => {
    if (!unlockedAchievements[def.id] && def.check(context)) {
      unlockedAchievements[def.id] = { unlockedAt: Date.now() };
      saveAchievements();
      UI.showAchievementToast(def.name);
    }
  });
}

const DAILY_TEMPLATES = [
  { type: 'score', label: (n) => `Reach a score of ${n} in a single flight` },
  { type: 'coins', label: (n) => `Collect ${n} coins in a single flight` },
  { type: 'pipes', label: (n) => `Clear ${n} pipes in a single flight` }
];

function getDailyChallenge() {
  const today = Util.dayString();
  let daily = Store.get(StorageKeys.DAILY, null);
  if (!daily || daily.date !== today) {
    const seed = Util.seedFromString(today);
    const template = DAILY_TEMPLATES[seed % DAILY_TEMPLATES.length];
    const target = 8 + (seed % 20); // 8..27
    daily = { date: today, type: template.type, target, label: template.label(target), completed: false, best: 0 };
    Store.set(StorageKeys.DAILY, daily);
  }
  return daily;
}

function updateDailyChallenge(runResult) {
  const daily = getDailyChallenge();
  const valueMap = { score: runResult.score, coins: runResult.coins, pipes: runResult.pipesCleared };
  const value = valueMap[daily.type] || 0;
  daily.best = Math.max(daily.best, value);
  if (!daily.completed && value >= daily.target) {
    daily.completed = true;
    Store.set(StorageKeys.DAILY, daily);
    UI.showAchievementToast('Daily Challenge Complete!');
    Audio_.notification();
  } else {
    Store.set(StorageKeys.DAILY, daily);
  }
  return daily;
}

// top-10 leaderboard, newest ties broken by insertion order
function addToLeaderboard(score, coins) {
  const board = Store.get(StorageKeys.LEADERBOARD, []);
  board.push({ score, coins, date: Date.now() });
  board.sort((a, b) => b.score - a.score);
  const trimmed = board.slice(0, 10);
  Store.set(StorageKeys.LEADERBOARD, trimmed);
  return trimmed;
}
function getLeaderboard() { return Store.get(StorageKeys.LEADERBOARD, []); }

// pooled particles — reuses dead slots instead of allocating new objects every frame
class ParticleSystem {
  constructor(maxParticles = 260) {
    this.pool = new Array(maxParticles).fill(null).map(() => ({ active: false }));
  }
  _getSlot() {
    for (const p of this.pool) if (!p.active) return p;
    return this.pool[0]; // recycle oldest if pool exhausted
  }
  spawn(opts) {
    const p = this._getSlot();
    Object.assign(p, {
      active: true, age: 0,
      x: opts.x, y: opts.y,
      vx: opts.vx || 0, vy: opts.vy || 0,
      life: opts.life || 0.6,
      size: opts.size || 4,
      color: opts.color || '#FFD37A',
      type: opts.type || 'dust',
      rotation: opts.rotation || 0,
      spin: opts.spin || 0,
      gravity: opts.gravity !== undefined ? opts.gravity : 260
    });
  }
  burst(x, y, count, factory) {
    for (let i = 0; i < count; i++) this.spawn(factory(i));
  }
  update(dt) {
    for (const p of this.pool) {
      if (!p.active) continue;
      p.age += dt;
      if (p.age >= p.life) { p.active = false; continue; }
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rotation += p.spin * dt;
    }
  }
  draw(ctx) {
    for (const p of this.pool) {
      if (!p.active) continue;
      const t = p.age / p.life;
      const alpha = 1 - t;
      ctx.save();
      ctx.globalAlpha = Util.clamp(alpha, 0, 1);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      if (p.type === 'spark') {
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.moveTo(0, -p.size); ctx.lineTo(p.size * 0.35, 0); ctx.lineTo(0, p.size); ctx.lineTo(-p.size * 0.35, 0);
        ctx.closePath(); ctx.fill();
      } else if (p.type === 'feather') {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.ellipse(0, 0, p.size, p.size * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.type === 'debris') {
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
      } else { // dust
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(0, 0, p.size * (1 - t * 0.5), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }
}

/* Floating score text (e.g. "+1", "+5") */
class FloatingTextSystem {
  constructor() { this.items = []; }
  spawn(x, y, text, color = '#FFD37A') {
    this.items.push({ x, y, text, color, age: 0, life: 0.9 });
  }
  update(dt) {
    this.items.forEach((it) => { it.age += dt; it.y -= 40 * dt; });
    this.items = this.items.filter((it) => it.age < it.life);
  }
  draw(ctx) {
    ctx.font = "bold 22px 'Space Mono', monospace";
    ctx.textAlign = 'center';
    this.items.forEach((it) => {
      const t = it.age / it.life;
      ctx.save();
      ctx.globalAlpha = 1 - t;
      ctx.fillStyle = it.color;
      ctx.shadowColor = it.color;
      ctx.shadowBlur = 6;
      ctx.fillText(it.text, it.x, it.y);
      ctx.restore();
    });
  }
}

// the bird, pipes and coins — all drawn straight onto the canvas, no sprites
class Bird {
  constructor() {
    this.reset();
  }
  reset() {
    this.x = 130;
    this.y = 260;
    this.vy = 0;
    this.radius = 18;
    this.rotation = 0;
    this.wingPhase = 0;
    this.wingSpeed = 10;
    this.idleTime = 0;
    this.trail = [];
    this.blinkTimer = Util.rand(1.5, 4);
    this.blinking = false;
    this.blinkElapsed = 0;
  }
  flap(power) {
    this.vy = power;
    this.wingSpeed = 22;
  }
  update(dt, gravity, playing) {
    if (playing) {
      this.vy += gravity * dt;
      this.y += this.vy * dt;
      this.rotation = Util.clamp(this.vy / 480, -0.6, 1.1);
      this.trail.push({ x: this.x - this.radius, y: this.y });
      if (this.trail.length > 8) this.trail.shift();
    } else {
      this.idleTime += dt;
      this.y = 260 + Math.sin(this.idleTime * 2.2) * 10;
      this.rotation = Math.sin(this.idleTime * 2.2) * 0.08;
    }
    this.wingSpeed = Util.lerp(this.wingSpeed, 9, dt * 2);
    this.wingPhase += dt * this.wingSpeed;

    // periodic blink for a bit of life in the eye
    if (this.blinking) {
      this.blinkElapsed += dt;
      if (this.blinkElapsed > 0.12) { this.blinking = false; this.blinkTimer = Util.rand(2, 5); }
    } else {
      this.blinkTimer -= dt;
      if (this.blinkTimer <= 0) { this.blinking = true; this.blinkElapsed = 0; }
    }
  }
  draw(ctx) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.rotation);

    // soft shadow beneath bird
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(2, this.radius + 4, this.radius * 0.9, this.radius * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // wing (behind body, animated flap)
    const wingFlap = Math.sin(this.wingPhase) * 0.9;
    ctx.save();
    ctx.translate(-4, 2);
    ctx.rotate(wingFlap * 0.9 - 0.2);
    const wingGrad = ctx.createLinearGradient(-14, -10, 8, 10);
    wingGrad.addColorStop(0, '#FF6B6B');
    wingGrad.addColorStop(1, '#F4A340');
    ctx.fillStyle = wingGrad;
    ctx.beginPath();
    ctx.ellipse(-6, 0, 14, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // body
    const bodyGrad = ctx.createRadialGradient(-4, -6, 4, 0, 0, this.radius + 6);
    bodyGrad.addColorStop(0, '#FFE9B8');
    bodyGrad.addColorStop(1, '#F4A340');
    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    ctx.ellipse(0, 0, this.radius, this.radius * 0.82, 0, 0, Math.PI * 2);
    ctx.fill();

    // belly highlight
    ctx.fillStyle = 'rgba(255,248,236,0.55)';
    ctx.beginPath();
    ctx.ellipse(-2, 6, this.radius * 0.6, this.radius * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();

    // tail feathers
    ctx.fillStyle = '#FF6B6B';
    ctx.beginPath();
    ctx.moveTo(-this.radius + 2, -2);
    ctx.lineTo(-this.radius - 10, -8);
    ctx.lineTo(-this.radius - 10, 4);
    ctx.closePath();
    ctx.fill();

    // eye (expressive: white + pupil + highlight, with an occasional blink)
    if (this.blinking) {
      ctx.strokeStyle = '#1B2A4A';
      ctx.lineWidth = 2.6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(2.5, -6);
      ctx.quadraticCurveTo(9, -3, 13.5, -6);
      ctx.stroke();
    } else {
      ctx.fillStyle = '#1B2A4A';
      ctx.beginPath();
      ctx.ellipse(7, -6, 5.4, 5.8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.ellipse(9, -8, 5.2, 5.6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1B2A4A';
      ctx.beginPath();
      ctx.arc(9.6, -7, 2.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(10.6, -8, 1, 0, Math.PI * 2);
      ctx.fill();
    }

    // beak
    ctx.fillStyle = '#FF9F45';
    ctx.beginPath();
    ctx.moveTo(this.radius - 4, -2);
    ctx.lineTo(this.radius + 12, 1);
    ctx.lineTo(this.radius - 4, 7);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }
}

class Pipe {
  constructor(x, gapY, gapHeight, width, groundY) {
    this.x = x;
    this.gapY = gapY;
    this.gapHeight = gapHeight;
    this.width = width;
    this.passed = false;
    this.groundY = groundY;
    this.hasVine = Math.random() < 0.35;
  }
  get topHeight() { return this.gapY - this.gapHeight / 2; }
  get bottomY() { return this.gapY + this.gapHeight / 2; }
  get bottomHeight() { return this.groundY - this.bottomY; }

  draw(ctx) {
    this._drawSegment(ctx, this.x, 0, this.width, this.topHeight, true);
    this._drawSegment(ctx, this.x, this.bottomY, this.width, this.bottomHeight, false);
  }
  _drawSegment(ctx, x, y, w, h, isTop) {
    if (h <= 0) return;
    const r = 10;
    ctx.save();
    // body gradient
    const grad = ctx.createLinearGradient(x, 0, x + w, 0);
    grad.addColorStop(0, '#3E9E68');
    grad.addColorStop(0.15, '#57C388');
    grad.addColorStop(0.5, '#4CAF7D');
    grad.addColorStop(0.85, '#3E9E68');
    grad.addColorStop(1, '#2E7C51');
    ctx.fillStyle = grad;
    roundRectPath(ctx, x, y, w, h, r);
    ctx.fill();

    // highlight strip
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(x + w * 0.14, y + 4, w * 0.14, Math.max(h - 8, 0));

    // cap (lip)
    const capH = 22;
    const capY = isTop ? y + h - capH : y;
    const capGrad = ctx.createLinearGradient(x - 4, 0, x + w + 4, 0);
    capGrad.addColorStop(0, '#2E7C51');
    capGrad.addColorStop(0.5, '#5FCB90');
    capGrad.addColorStop(1, '#2E7C51');
    ctx.fillStyle = capGrad;
    roundRectPath(ctx, x - 4, capY, w + 8, capH, 8);
    ctx.fill();

    // shadow under cap
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.fillRect(x - 4, capY + capH - 4, w + 8, 4);

    ctx.restore();

    // decorative vine
    if (this.hasVine) {
      ctx.save();
      ctx.strokeStyle = 'rgba(46,124,81,0.8)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      const vx = x + w * 0.25;
      const startY = isTop ? y + h - 30 : y + 30;
      const dir = isTop ? -1 : 1;
      ctx.moveTo(vx, startY);
      ctx.quadraticCurveTo(vx + 10, startY + dir * 20, vx - 6, startY + dir * 40);
      ctx.stroke();
      ctx.fillStyle = '#FF8FA3';
      ctx.beginPath();
      ctx.arc(vx - 6, startY + dir * 40, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}
function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

class Coin {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.radius = 12;
    this.collected = false;
    this.phase = Math.random() * Math.PI * 2;
  }
  update(dt) { this.phase += dt * 4; }
  draw(ctx) {
    if (this.collected) return;
    const squash = Math.abs(Math.cos(this.phase));
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.scale(Util.lerp(0.4, 1, squash), 1);
    const grad = ctx.createRadialGradient(-3, -3, 2, 0, 0, this.radius);
    grad.addColorStop(0, '#FFF3D2');
    grad.addColorStop(0.6, '#FFD37A');
    grad.addColorStop(1, '#E8A33B');
    ctx.fillStyle = grad;
    ctx.shadowColor = 'rgba(255,211,122,0.8)';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#C97F2E';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = '#C97F2E';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('$', 0, 1);
    ctx.restore();
  }
}

// parallax sky, mountains, clouds and ground scroll
class Background {
  constructor() {
    this.clouds = new Array(6).fill(null).map(() => this._makeCloud());
    this.mountains = new Array(2).fill(null).map((_, i) => ({ offset: i * 400 }));
    this.birds = new Array(3).fill(null).map(() => ({ x: Math.random() * 800, y: Util.rand(40, 160), speed: Util.rand(30, 60), phase: Math.random() * 10 }));
    this.groundScroll = 0;
    this.leaves = new Array(10).fill(null).map(() => ({ x: Math.random() * 800, y: Util.rand(-50, 0), speed: Util.rand(20, 50), sway: Math.random() * 10 }));
  }
  _makeCloud() {
    return { x: Math.random() * 900, y: Util.rand(30, 220), scale: Util.rand(0.6, 1.4), speed: Util.rand(8, 22) };
  }
  update(dt, w, h, speedMultiplier) {
    this.clouds.forEach((c) => { c.x -= c.speed * dt * speedMultiplier * 0.4; if (c.x < -140) { c.x = w + 140; c.y = Util.rand(30, h * 0.4); } });
    this.birds.forEach((b) => { b.x -= b.speed * dt * speedMultiplier * 0.6; b.phase += dt * 6; if (b.x < -30) b.x = w + 30; });
    this.leaves.forEach((l) => { l.y += l.speed * dt; l.x += Math.sin(l.y * 0.05) * l.sway * dt; if (l.y > h) { l.y = -20; l.x = Math.random() * w; } });
    this.groundScroll -= 140 * dt * speedMultiplier;
  }
  drawSky(ctx, w, h, theme) {
    const themes = {
      dawn: ['#FFE9C7', '#FFCB8E', '#F4A340'],
      dusk: ['#F0A464', '#B96B4E', '#6B4E8E'],
      night: ['#26365C', '#1B2A4A', '#101a30']
    };
    const colors = themes[theme] || themes.dawn;
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, colors[0]);
    grad.addColorStop(0.55, colors[1]);
    grad.addColorStop(1, colors[2]);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // sun / moon glow
    ctx.save();
    ctx.globalAlpha = 0.7;
    const glow = ctx.createRadialGradient(w * 0.78, h * 0.22, 10, w * 0.78, h * 0.22, 160);
    glow.addColorStop(0, theme === 'night' ? 'rgba(220,230,255,0.7)' : 'rgba(255,240,200,0.85)');
    glow.addColorStop(1, 'rgba(255,240,200,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();

    // soft god-rays fanning from the sun for a premium, painterly sky
    if (theme !== 'night') {
      ctx.save();
      ctx.globalAlpha = 0.06;
      ctx.fillStyle = '#FFFFFF';
      const sx = w * 0.78, sy = h * 0.22;
      for (let i = 0; i < 6; i++) {
        const a1 = (i / 6) * Math.PI * 2;
        const a2 = a1 + 0.12;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + Math.cos(a1) * w, sy + Math.sin(a1) * w);
        ctx.lineTo(sx + Math.cos(a2) * w, sy + Math.sin(a2) * w);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }
  }
  drawFarLayers(ctx, w, h) {
    // mountains
    ctx.fillStyle = 'rgba(107,78,142,0.35)';
    this.mountains.forEach((m) => {
      ctx.beginPath();
      ctx.moveTo(m.offset - 100, h * 0.72);
      ctx.lineTo(m.offset + 60, h * 0.5);
      ctx.lineTo(m.offset + 220, h * 0.72);
      ctx.closePath();
      ctx.fill();
    });
    // clouds
    this.clouds.forEach((c) => {
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.translate(c.x, c.y);
      ctx.scale(c.scale, c.scale);
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.ellipse(0, 0, 40, 16, 0, 0, Math.PI * 2);
      ctx.ellipse(-24, 6, 24, 14, 0, 0, Math.PI * 2);
      ctx.ellipse(26, 4, 26, 15, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
    // distant birds
    ctx.strokeStyle = 'rgba(27,42,74,0.5)';
    ctx.lineWidth = 2;
    this.birds.forEach((b) => {
      const flap = Math.sin(b.phase) * 6;
      ctx.beginPath();
      ctx.moveTo(b.x - 8, b.y - flap);
      ctx.quadraticCurveTo(b.x, b.y + 4, b.x + 8, b.y - flap);
      ctx.stroke();
    });
    // falling leaves
    ctx.fillStyle = 'rgba(76,175,125,0.6)';
    this.leaves.forEach((l) => {
      ctx.save();
      ctx.translate(l.x, l.y);
      ctx.rotate(l.y * 0.02);
      ctx.beginPath();
      ctx.ellipse(0, 0, 5, 3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  }
  drawGround(ctx, w, h, groundY) {
    ctx.fillStyle = '#3E9E68';
    ctx.fillRect(0, groundY, w, h - groundY);
    ctx.fillStyle = '#4CAF7D';
    ctx.fillRect(0, groundY, w, 10);
    // scrolling dashes for a sense of speed
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    const dashW = 26, gap = 20, total = dashW + gap;
    let start = this.groundScroll % total;
    for (let x = start; x < w; x += total) ctx.fillRect(x, groundY + 3, dashW, 4);
    // little bushes
    ctx.fillStyle = '#3E8E5C';
    for (let x = (this.groundScroll * 0.6) % 160; x < w; x += 160) {
      ctx.beginPath();
      ctx.ellipse(x, groundY + 2, 22, 12, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// the actual game loop: physics, spawning, collisions, scoring
const DIFFICULTY_PRESETS = {
  easy: { gapHeight: 190, speed: 170, spawnGap: 260 },
  medium: { gapHeight: 160, speed: 210, spawnGap: 230 },
  hard: { gapHeight: 132, speed: 260, spawnGap: 205 }
};

const STATE = { LOADING: 'loading', MENU: 'menu', READY: 'ready', PLAYING: 'playing', PAUSED: 'paused', GAMEOVER: 'gameover' };

class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.width = 0; this.height = 0; this.dpr = 1;
    this.state = STATE.MENU;
    this.bird = new Bird();
    this.background = new Background();
    this.particles = new ParticleSystem();
    this.floatingText = new FloatingTextSystem();
    this.pipes = [];
    this.coins = [];
    this.score = 0;
    this.coinsThisRun = 0;
    this.combo = 0;
    this.pipesCleared = 0;
    this.coinsSpawned = 0;
    this.timeSinceSpawn = 0;
    this.groundY = 0;
    this.lastFrame = performance.now();
    this.fpsSmoothed = 60;
    this.frameAccum = 0;
    this.frameCount = 0;
    this._resizeHandler = this.resize.bind(this);
    window.addEventListener('resize', this._resizeHandler);
    this.resize();
    requestAnimationFrame(this.loop.bind(this));
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = rect.width; this.height = rect.height;
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.groundY = this.height - 70;
    this.bird.x = Math.max(110, this.width * 0.22);
  }

  difficultyPreset() { return DIFFICULTY_PRESETS[settings.difficulty] || DIFFICULTY_PRESETS.medium; }

  currentLevel() { return 1 + Math.floor(this.score / 10); }

  currentTheme() {
    // sky drifts from the chosen base theme toward dusk/night as score climbs — ties difficulty to atmosphere
    if (this.score >= 40) return 'night';
    if (this.score >= 18) return 'dusk';
    return settings.theme === 'night' ? 'night' : (settings.theme === 'dusk' ? 'dusk' : 'dawn');
  }

  startRun() {
    this.bird.reset();
    this.bird.x = Math.max(110, this.width * 0.22);
    this.pipes = [];
    this.coins = [];
    this.score = 0;
    this.coinsThisRun = 0;
    this.combo = 0;
    this.pipesCleared = 0;
    this.coinsSpawned = 0;
    this.timeSinceSpawn = 0;
    this.state = STATE.READY;
  }

  beginFlying() {
    if (this.state !== STATE.READY) return;
    this.state = STATE.PLAYING;
    Audio_.playMusic('gameplay');
  }

  flap() {
    if (this.state === STATE.READY) this.beginFlying();
    if (this.state !== STATE.PLAYING) return;
    this.bird.flap(-330);
    Audio_.flap();
    this.particles.burst(this.bird.x - 14, this.bird.y + 6, 3, () => ({
      x: this.bird.x - 14, y: this.bird.y + 6,
      vx: Util.rand(-40, -10), vy: Util.rand(20, 60),
      life: Util.rand(0.3, 0.5), size: Util.rand(2, 4),
      color: '#FFE9B8', type: 'feather', gravity: 120, spin: Util.rand(-4, 4)
    }));
  }

  spawnPipePair() {
    const preset = this.difficultyPreset();
    const margin = 60;
    const gapHeight = Math.max(110, preset.gapHeight - this.currentLevel() * 2.4);
    const gapY = Util.rand(margin + gapHeight / 2, this.groundY - margin - gapHeight / 2);
    const pipe = new Pipe(this.width + 40, gapY, gapHeight, 70, this.groundY);
    this.pipes.push(pipe);
    // ~55% chance of a coin centered in the gap
    if (Math.random() < 0.55) {
      this.coins.push(new Coin(pipe.x + pipe.width / 2, gapY + Util.rand(-16, 16)));
      this.coinsSpawned += 1;
    }
  }

  registerHit() {
    if (this.state !== STATE.PLAYING) return;
    this.state = STATE.GAMEOVER;
    Audio_.collision();
    Audio_.stopMusic();
    this.particles.burst(this.bird.x, this.bird.y, 22, () => ({
      x: this.bird.x, y: this.bird.y,
      vx: Util.rand(-160, 160), vy: Util.rand(-220, 40),
      life: Util.rand(0.4, 0.9), size: Util.rand(2, 5),
      color: Util.choice(['#FF6B6B', '#F4A340', '#FFD37A', '#fff']),
      type: 'debris', gravity: 400, spin: Util.rand(-8, 8)
    }));
    UI.onGameOver();
  }

  update(dt) {
    const preset = this.difficultyPreset();
    const speedMultiplier = 1 + Math.min(this.currentLevel() * 0.045, 0.9);
    const scrollSpeed = preset.speed * speedMultiplier;

    this.background.update(dt, this.width, this.height, this.state === STATE.PLAYING ? speedMultiplier : 0.4);
    this.particles.update(dt);
    this.floatingText.update(dt);
    this.coins.forEach((c) => c.update(dt));

    if (this.state === STATE.PLAYING) {
      this.bird.update(dt, 980, true);

      // ground / ceiling collision
      if (this.bird.y + this.bird.radius >= this.groundY) {
        this.bird.y = this.groundY - this.bird.radius;
        this.registerHit();
      } else if (this.bird.y - this.bird.radius <= 0) {
        this.bird.y = this.bird.radius;
        this.bird.vy = 0;
      }

      // pipes — spawn based on horizontal distance traveled, not wall-clock time,
      // so pipe density stays consistent regardless of frame-rate hiccups.
      this.timeSinceSpawn += scrollSpeed * dt;
      if (this.timeSinceSpawn >= preset.spawnGap) {
        this.spawnPipePair();
        this.timeSinceSpawn = 0;
      }
      this.pipes.forEach((p) => { p.x -= scrollSpeed * dt; });
      this.pipes = this.pipes.filter((p) => p.x + p.width > -60);

      // pipe collision + scoring
      for (const p of this.pipes) {
        const birdLeft = this.bird.x - this.bird.radius * 0.75;
        const birdRight = this.bird.x + this.bird.radius * 0.75;
        const birdTop = this.bird.y - this.bird.radius * 0.75;
        const birdBottom = this.bird.y + this.bird.radius * 0.75;
        const withinX = birdRight > p.x && birdLeft < p.x + p.width;
        if (withinX) {
          const hitsTop = birdTop < p.topHeight;
          const hitsBottom = birdBottom > p.bottomY;
          if (hitsTop || hitsBottom) { this.registerHit(); break; }
        }
        if (!p.passed && p.x + p.width < this.bird.x) {
          p.passed = true;
          this.score += 1;
          this.pipesCleared += 1;
          Audio_.passPipe();
          this.floatingText.spawn(this.bird.x, this.bird.y - 30, '+1', '#FFD37A');
          UI.pulseMilestone();
        }
      }

      // coins
      for (const c of this.coins) {
        if (c.collected) continue;
        const dx = c.x - this.bird.x, dy = c.y - this.bird.y;
        if (Math.hypot(dx, dy) < c.radius + this.bird.radius * 0.8) {
          c.collected = true;
          this.combo += 1;
          this.coinsThisRun += 1;
          totalCoins += 1;
          saveCoins();
          const bonus = 5 * Math.min(this.combo, 5);
          this.score += bonus;
          Audio_.coin();
          this.particles.burst(c.x, c.y, 10, () => ({
            x: c.x, y: c.y, vx: Util.rand(-60, 60), vy: Util.rand(-90, -20),
            life: Util.rand(0.3, 0.5), size: Util.rand(2, 4), color: '#FFD37A', type: 'spark', gravity: 200
          }));
          this.floatingText.spawn(c.x, c.y - 20, `+${bonus}`, '#F4A340');
          UI.showCombo(this.combo);
        }
      }
      this.coins = this.coins.filter((c) => c.x > -40);
    } else {
      this.bird.update(dt, 0, false);
    }
  }

  draw() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);

    ctx.save();

    this.background.drawSky(ctx, this.width, this.height, this.currentTheme());
    this.background.drawFarLayers(ctx, this.width, this.height);

    this.pipes.forEach((p) => p.draw(ctx));
    this.coins.forEach((c) => c.draw(ctx));

    // bird motion trail (only while playing, subtle motion blur feel)
    if (this.state === STATE.PLAYING) {
      this.bird.trail.forEach((t, i) => {
        ctx.save();
        ctx.globalAlpha = (i / this.bird.trail.length) * 0.15;
        ctx.fillStyle = '#F4A340';
        ctx.beginPath();
        ctx.arc(t.x, t.y, this.bird.radius * 0.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });
    }

    this.background.drawGround(ctx, this.width, this.height, this.groundY);
    this.bird.draw(ctx);
    this.particles.draw(ctx);
    this.floatingText.draw(ctx);

    ctx.restore();
  }

  loop(now) {
    const dt = Math.min((now - this.lastFrame) / 1000, 1 / 30);
    this.lastFrame = now;

    this.frameAccum += dt;
    this.frameCount++;
    if (this.frameAccum >= 0.5) {
      this.fpsSmoothed = Math.round(this.frameCount / this.frameAccum);
      this.frameAccum = 0; this.frameCount = 0;
      UI.updateFps(this.fpsSmoothed);
    }

    if (this.state !== STATE.PAUSED) this.update(dt);
    this.draw();

    if (this.state === STATE.PLAYING) UI.syncHud(this);

    requestAnimationFrame(this.loop.bind(this));
  }
}

// screen switching, button wiring, HUD updates — all the DOM glue
const UI = {
  els: {},
  game: null,
  currentScreen: 'menu',
  runStartCoins: 0,

  init(game) {
    this.game = game;
    this.cacheEls();
    this.bindGlobalInput();
    this.bindMenuActions();
    this.bindSettings();
    this.renderMenuStats();
    this.renderDailyChallenge();
  },

  cacheEls() {
    const ids = [
      'menu-screen', 'howto-screen', 'highscores-screen', 'settings-screen', 'credits-screen',
      'hud', 'ready-overlay', 'pause-screen', 'gameover-screen',
      'hud-score', 'hud-best', 'hud-coins', 'hud-level', 'milestone-fill', 'fps-counter',
      'combo-display', 'combo-value', 'menu-best-score', 'menu-total-coins', 'menu-games-played',
      'leaderboard-list', 'leaderboard-empty', 'final-score', 'final-best', 'final-coins',
      'final-accuracy', 'final-distance', 'final-pipes', 'newrecord-banner', 'confetti-layer',
      'achievement-toast', 'achievement-toast-name', 'daily-challenge-text'
    ];
    ids.forEach((id) => { this.els[id] = document.getElementById(id); });
  },

  screenIds: ['menu-screen', 'howto-screen', 'highscores-screen', 'settings-screen', 'credits-screen', 'pause-screen', 'gameover-screen'],

  showScreen(id) {
    this.screenIds.forEach((sid) => {
      if (!this.els[sid]) return;
      this.els[sid].classList.toggle('hidden', sid !== id);
    });
    this.currentScreen = id;
  },

  hideAllPanels() {
    ['howto-screen', 'highscores-screen', 'settings-screen', 'credits-screen', 'pause-screen', 'gameover-screen'].forEach((sid) => {
      this.els[sid] && this.els[sid].classList.add('hidden');
    });
  },

  bindGlobalInput() {
    document.addEventListener('click', (e) => {
      const target = e.target.closest('[data-action]');
      if (!target) return;
      this.handleAction(target.dataset.action, target, e);
    });

    // flap input: space/up/click on canvas area while playing or ready
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' || e.code === 'ArrowUp') {
        e.preventDefault();
        this.handleFlapInput();
      } else if (e.code === 'Escape') {
        if (this.game.state === STATE.PLAYING) this.pauseGame();
      }
    });
    const canvasArea = document.getElementById('stage');
    canvasArea.addEventListener('mousedown', () => this.handleFlapInput());
    canvasArea.addEventListener('touchstart', (e) => { e.preventDefault(); this.handleFlapInput(); }, { passive: false });
  },

  handleFlapInput() {
    Audio_.resume();
    if (this.game.state === STATE.MENU) return; // menu clicks handled by buttons only
    if (this.game.state === STATE.READY || this.game.state === STATE.PLAYING) {
      this.game.flap();
    }
  },

  handleAction(action, target, evt) {
    Audio_.resume();
    this.ripple(target, evt);
    switch (action) {
      case 'start-game': Audio_.click(); this.startGame(); break;
      case 'show-howto': Audio_.click(); this.hideAllPanels(); this.showScreen('howto-screen'); break;
      case 'show-highscores': Audio_.click(); this.renderLeaderboard(); this.hideAllPanels(); this.showScreen('highscores-screen'); break;
      case 'show-settings': Audio_.click(); this.hideAllPanels(); this.showScreen('settings-screen'); break;
      case 'show-credits': Audio_.click(); this.hideAllPanels(); this.showScreen('credits-screen'); break;
      case 'back-to-menu': Audio_.click(); this.hideAllPanels(); this.showScreen('menu-screen'); break;
      case 'toggle-pause': this.pauseGame(); break;
      case 'resume-game': Audio_.click(); this.resumeGame(); break;
      case 'restart-game': Audio_.click(); this.startGame(); break;
      case 'quit-to-menu': Audio_.click(); this.quitToMenu(); break;
      case 'play-again': Audio_.click(); this.startGame(); break;
      case 'share-score': Audio_.click(); this.shareScore(); break;
      case 'toggle-sound': this.toggleSound(); break;
      case 'toggle-music': this.toggleMusic(); break;
      case 'reset-highscore': this.resetHighScore(); break;
      case 'reset-progress': this.resetProgress(); break;
      default: break;
    }
  },

  ripple(target, evt) {
    if (!target.classList || !target.classList.contains('menu-btn')) return;
    const rect = target.getBoundingClientRect();
    const span = document.createElement('span');
    span.className = 'ripple';
    const size = Math.max(rect.width, rect.height);
    span.style.width = span.style.height = size + 'px';
    const x = (evt && evt.clientX ? evt.clientX - rect.left : rect.width / 2) - size / 2;
    const y = (evt && evt.clientY ? evt.clientY - rect.top : rect.height / 2) - size / 2;
    span.style.left = x + 'px'; span.style.top = y + 'px';
    target.appendChild(span);
    setTimeout(() => span.remove(), 650);
  },

  /* ---- flow control ---- */
  startGame() {
    this.hideAllPanels();
    this.showScreen('menu-screen'); // menu stays underneath but hidden by HUD/overlay below
    this.els['menu-screen'].classList.add('hidden');
    this.els['hud'].classList.remove('hidden');
    this.els['ready-overlay'].classList.remove('hidden');
    this.runStartCoins = totalCoins;
    this.game.startRun();
    this.syncHud(this.game);
    this.els['milestone-fill'].style.width = '0%';
  },

  onFlapMaybeStart() {
    if (this.game.state === STATE.PLAYING) {
      this.els['ready-overlay'].classList.add('hidden');
    }
  },

  pauseGame() {
    if (this.game.state !== STATE.PLAYING) return;
    this.game.state = STATE.PAUSED;
    Audio_.stopMusic();
    this.showScreen('pause-screen');
  },

  resumeGame() {
    this.hideAllPanels();
    this.game.state = STATE.PLAYING;
    Audio_.playMusic('gameplay');
  },

  quitToMenu() {
    this.hideAllPanels();
    this.els['hud'].classList.add('hidden');
    this.els['ready-overlay'].classList.add('hidden');
    this.game.state = STATE.MENU;
    this.els['menu-screen'].classList.remove('hidden');
    this.renderMenuStats();
    this.renderDailyChallenge();
    Audio_.playMusic('menu');
  },

  onGameOver() {
    this.els['ready-overlay'].classList.add('hidden');
    gamesPlayed += 1; saveGamesPlayed();
    const isNewBest = this.game.score > bestScore;
    if (isNewBest) { bestScore = this.game.score; saveBest(); }
    addToLeaderboard(this.game.score, this.game.coinsThisRun);

    const perfectRun = this.game.pipesCleared >= 5 && this.game.coinsSpawned > 0 && this.game.coinsThisRun === this.game.coinsSpawned;
    if (perfectRun) { stats.perfectRuns = (stats.perfectRuns || 0) + 1; saveStats(); }

    checkAchievements({
      score: this.game.score,
      totalCoins,
      gamesPlayedTotal: gamesPlayed,
      perfectRun
    });

    const daily = updateDailyChallenge({ score: this.game.score, coins: this.game.coinsThisRun, pipesCleared: this.game.pipesCleared });
    this.renderDailyChallenge(daily);

    this.els['final-score'].textContent = this.game.score;
    this.els['final-best'].textContent = bestScore;
    this.els['final-coins'].textContent = this.game.coinsThisRun;
    const accuracy = this.game.pipesCleared > 0 ? Math.round((this.game.coinsThisRun / Math.max(this.game.pipesCleared, 1)) * 100) : 0;
    this.els['final-accuracy'].textContent = Util.clamp(accuracy, 0, 100) + '%';
    this.els['final-distance'].textContent = Math.round(this.game.pipesCleared * 42) + ' m';
    this.els['final-pipes'].textContent = this.game.pipesCleared;
    this.els['newrecord-banner'].classList.toggle('hidden', !isNewBest);

    if (isNewBest) { Audio_.victoryJingle(); this.spawnConfetti(); }
    else Audio_.gameOverJingle();

    this.els['hud'].classList.add('hidden');
    setTimeout(() => this.showScreen('gameover-screen'), 250);
  },

  spawnConfetti() {
    const layer = this.els['confetti-layer'];
    layer.innerHTML = '';
    const colors = ['#FF6B6B', '#F4A340', '#FFD37A', '#4CAF7D', '#6B4E8E', '#FFF8EC'];
    for (let i = 0; i < 40; i++) {
      const piece = document.createElement('span');
      piece.className = 'confetti-piece';
      piece.style.left = Math.random() * 100 + '%';
      piece.style.background = Util.choice(colors);
      piece.style.animationDuration = Util.rand(1.4, 2.6) + 's';
      piece.style.animationDelay = Util.rand(0, 0.6) + 's';
      layer.appendChild(piece);
    }
  },

  shareScore() {
    const text = `I just scored ${this.game.score} in Golden Wing! Can you beat it?`;
    if (navigator.share) {
      navigator.share({ title: 'Golden Wing', text }).catch(() => {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => this.showAchievementToast('Score copied to clipboard!'));
    }
  },

  toggleSound() {
    Audio_.setSfxEnabled(!Audio_.sfxEnabled);
    const btn = document.querySelector('[data-action="toggle-sound"]');
    if (btn) btn.classList.toggle('muted', !Audio_.sfxEnabled);
    if (Audio_.sfxEnabled) Audio_.click();
  },
  toggleMusic() {
    Audio_.setMusicEnabled(!Audio_.musicEnabled);
    const btn = document.querySelector('[data-action="toggle-music"]');
    if (btn) btn.classList.toggle('muted', !Audio_.musicEnabled);
    if (Audio_.musicEnabled) {
      Audio_.playMusic(this.game.state === STATE.PLAYING ? 'gameplay' : 'menu');
    }
  },

  resetHighScore() {
    bestScore = 0; saveBest();
    Store.set(StorageKeys.LEADERBOARD, []);
    this.renderMenuStats();
    Audio_.notification();
  },
  resetProgress() {
    bestScore = 0; totalCoins = 0; gamesPlayed = 0; unlockedAchievements = {}; stats = { perfectRuns: 0 };
    saveBest(); saveCoins(); saveGamesPlayed(); saveAchievements(); saveStats();
    Store.set(StorageKeys.LEADERBOARD, []);
    this.renderMenuStats();
    Audio_.notification();
  },

  /* ---- HUD ---- */
  syncHud(game) {
    this.els['hud-score'].textContent = game.score;
    this.els['hud-best'].textContent = Math.max(bestScore, game.score);
    this.els['hud-coins'].textContent = game.coinsThisRun;
    this.els['hud-level'].textContent = game.currentLevel();
    const beatingBest = bestScore > 0 && game.score > bestScore;
    this.els['hud-score'].parentElement.classList.toggle('beating-best', beatingBest);
    this.els['hud-score'].classList.toggle('beating-best-text', beatingBest);
    this.onFlapMaybeStart();
  },
  updateFps(fps) { if (this.els['fps-counter']) this.els['fps-counter'].textContent = fps + ' FPS'; },
  pulseMilestone() {
    const el = this.els['milestone-fill'];
    const pct = (this.game.score % 10) * 10;
    el.style.width = pct + '%';
  },
  showCombo(value) {
    const el = this.els['combo-display'];
    this.els['combo-value'].textContent = value;
    el.classList.remove('hidden');
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
    clearTimeout(this._comboTimer);
    this._comboTimer = setTimeout(() => el.classList.add('hidden'), 900);
  },

  /* ---- menu stats / leaderboard / daily ---- */
  renderMenuStats() {
    this.els['menu-best-score'].textContent = bestScore;
    this.els['menu-total-coins'].textContent = totalCoins;
    this.els['menu-games-played'].textContent = gamesPlayed;
  },
  renderLeaderboard() {
    const board = getLeaderboard();
    const list = this.els['leaderboard-list'];
    list.innerHTML = '';
    this.els['leaderboard-empty'].classList.toggle('hidden', board.length > 0);
    board.forEach((entry, i) => {
      const li = document.createElement('li');
      if (i === 0) li.classList.add('top1');
      li.innerHTML = `<span class="rank">#${i + 1}</span><span class="lb-score">${entry.score} pts</span><span class="lb-date">${Util.formatDate(entry.date)}</span>`;
      list.appendChild(li);
    });
  },
  renderDailyChallenge(dailyArg) {
    const daily = dailyArg || getDailyChallenge();
    const el = this.els['daily-challenge-text'];
    if (!el) return;
    el.textContent = daily.completed ? `✓ Completed: ${daily.label}` : daily.label;
  },

  /* ---- achievement toast ---- */
  showAchievementToast(name) {
    const toast = this.els['achievement-toast'];
    this.els['achievement-toast-name'].textContent = name;
    toast.classList.remove('hidden');
    requestAnimationFrame(() => toast.classList.add('show'));
    Audio_.achievement();
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.classList.add('hidden'), 500);
    }, 2600);
  },

  /* ---- settings bindings ---- */
  bindSettings() {
    const musicSlider = document.getElementById('music-volume');
    const sfxSlider = document.getElementById('sfx-volume');
    musicSlider.value = settings.musicVolume;
    sfxSlider.value = settings.sfxVolume;
    musicSlider.addEventListener('input', (e) => { settings.musicVolume = +e.target.value; Audio_.updateVolumes(); saveSettings(); });
    sfxSlider.addEventListener('input', (e) => { settings.sfxVolume = +e.target.value; Audio_.updateVolumes(); saveSettings(); Audio_.click(); });

    this.bindSegmented('difficulty-select', (v) => { settings.difficulty = v; saveSettings(); });
    this.bindSegmented('graphics-select', (v) => { settings.graphics = v; saveSettings(); });
    this.bindSegmented('theme-select', (v) => { settings.theme = v; saveSettings(); });

    document.getElementById('difficulty-select').dataset.value = settings.difficulty;
    document.getElementById('graphics-select').dataset.value = settings.graphics;
    document.getElementById('theme-select').dataset.value = settings.theme;
    this.syncSegmentedUI('difficulty-select');
    this.syncSegmentedUI('graphics-select');
    this.syncSegmentedUI('theme-select');

    const animToggle = document.getElementById('animations-toggle');
    animToggle.checked = settings.animations;
    document.body.classList.toggle('no-animations', !settings.animations);
    animToggle.addEventListener('change', (e) => {
      settings.animations = e.target.checked;
      document.body.classList.toggle('no-animations', !settings.animations);
      saveSettings();
    });

    const fsToggle = document.getElementById('fullscreen-toggle');
    fsToggle.addEventListener('change', (e) => {
      settings.fullscreen = e.target.checked; saveSettings();
      if (e.target.checked) {
        document.documentElement.requestFullscreen?.().catch(() => {});
      } else if (document.fullscreenElement) {
        document.exitFullscreen?.().catch(() => {});
      }
    });
  },
  bindSegmented(id, onChange) {
    const el = document.getElementById(id);
    el.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => {
        el.dataset.value = btn.dataset.value;
        this.syncSegmentedUI(id);
        onChange(btn.dataset.value);
        Audio_.click();
      });
    });
  },
  syncSegmentedUI(id) {
    const el = document.getElementById(id);
    const val = el.dataset.value;
    el.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.value === val));
  },

  bindMenuActions() {
    // covered via delegation in bindGlobalInput; placeholder kept for clarity/extension
  }
};

// loading screen animation + kicking the whole thing off
const LOADING_STATUS_STEPS = [
  { at: 0, label: 'Waking the sky' },
  { at: 20, label: 'Stretching wings' },
  { at: 45, label: 'Charting the wind' },
  { at: 70, label: 'Climbing higher' },
  { at: 90, label: 'Almost airborne' }
];

function initLoadingParticles() {
  const field = document.getElementById('loading-particles');
  for (let i = 0; i < 18; i++) {
    const span = document.createElement('span');
    span.style.left = Math.random() * 100 + '%';
    span.style.animationDuration = Util.rand(4, 9) + 's';
    span.style.animationDelay = Util.rand(0, 6) + 's';
    span.style.width = span.style.height = Util.rand(3, 7) + 'px';
    field.appendChild(span);
  }
}

function runLoadingSequence(onComplete) {
  const sun = document.getElementById('loading-sun');
  const path = document.getElementById('flight-path');
  const bird = document.getElementById('loading-bird');
  const statusEl = document.getElementById('loading-status');
  const percentEl = document.getElementById('loading-percent-num');
  const pathLength = path.getTotalLength();

  let progress = 0;
  const step = () => {
    progress = Math.min(progress + Util.rand(4, 11), 100);
    const t = progress / 100;

    // sun rises out of the horizon as loading nears completion
    sun.setAttribute('cy', Util.lerp(300, 55, t));
    sun.setAttribute('r', Util.lerp(50, 95, t));

    // bird slides along the dashed flight path, pointed the way it's heading
    const point = path.getPointAtLength(t * pathLength);
    const ahead = path.getPointAtLength(Math.min(t * pathLength + 4, pathLength));
    const heading = Math.atan2(ahead.y - point.y, ahead.x - point.x) * (180 / Math.PI);
    bird.setAttribute('transform', `translate(${point.x} ${point.y}) rotate(${heading})`);

    const status = LOADING_STATUS_STEPS.filter((s) => progress >= s.at).pop();
    statusEl.textContent = status.label;
    percentEl.textContent = Math.round(progress);

    if (progress < 100) {
      setTimeout(step, Util.rand(90, 170));
    } else {
      setTimeout(onComplete, 400);
    }
  };
  step();
}

document.addEventListener('DOMContentLoaded', () => {
  initLoadingParticles();

  runLoadingSequence(() => {
    const loadingScreen = document.getElementById('loading-screen');
    const app = document.getElementById('app');
    loadingScreen.classList.add('fade-out');
    app.classList.remove('hidden');
    app.classList.add('fade-in');
    setTimeout(() => loadingScreen.remove(), 850);

    const canvas = document.getElementById('game-canvas');
    const game = new Game(canvas);
    UI.init(game);
    Audio_.playMusic('menu');
  });
});

/*
 * A note on audio: this build ships with zero binary audio files so the project works the
 * moment you copy the three source files — every sound effect and music
 * loop above is synthesized live with the Web Audio API (oscillators,
 * noise bursts and gain envelopes).
 * To use your own recorded audio instead:
 * 1. Drop mp3/ogg files next to this script (or into a folder of your
 * choosing).
 * 2. Replace the body of each method on AudioEngine (flap, coin, point,
 * passPipe, collision, click, achievement, notification,
 * gameOverJingle, victoryJingle, playMusic) with an
 * `new Audio('your-file.mp3').play()` call, or preload an
 * <audio> element per effect for lower latency.
 * The rest of the game (physics, UI, storage) does not need to change.
 */
