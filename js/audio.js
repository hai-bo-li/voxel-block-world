/**
 * 像素方块世界 - 音效系统
 * 使用 Web Audio API 程序化生成所有音效，无需外部音频文件
 */

class AudioManager {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.volume = 0.4;
    this._initAttempted = false;
  }

  /** 延迟初始化（需要用户交互后才能创建 AudioContext） */
  _ensureCtx() {
    if (this.ctx) return true;
    if (this._initAttempted) return false;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this._initAttempted = true;
      return true;
    } catch (e) {
      this._initAttempted = true;
      return false;
    }
  }

  /** 尝试在用户交互时恢复 AudioContext */
  resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  /** 播放音效 */
  _play(type, params = {}) {
    if (!this.enabled) return;
    if (!this._ensureCtx()) return;

    const ctx = this.ctx;
    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(this.volume * (params.vol || 1), now);

    switch (type) {
      case 'shoot': this._shootSound(ctx, now, gain, params); break;
      case 'shotgun': this._shotgunSound(ctx, now, gain, params); break;
      case 'swing': this._swingSound(ctx, now, gain, params); break;
      case 'hit': this._hitSound(ctx, now, gain, params); break;
      case 'kill': this._killSound(ctx, now, gain, params); break;
      case 'hurt': this._hurtSound(ctx, now, gain, params); break;
      case 'reload': this._reloadSound(ctx, now, gain, params); break;
      case 'step': this._stepSound(ctx, now, gain, params); break;
      case 'block_break': this._blockBreakSound(ctx, now, gain, params); break;
      case 'quest': this._questSound(ctx, now, gain, params); break;
      case 'wave': this._waveSound(ctx, now, gain, params); break;
    }
  }

  /** 激光手枪/步枪射击 - 短促电子音 */
  _shootSound(ctx, now, gain, params) {
    const osc = ctx.createOscillator();
    const freq = params.pitch || 800;
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.3, now + 0.08);
    gain.gain.setValueAtTime(this.volume * 0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    osc.connect(gain);
    osc.start(now);
    osc.stop(now + 0.1);
  }

  /** 霰弹枪 - 低沉爆破音 */
  _shotgunSound(ctx, now, gain) {
    // 噪声爆破
    const bufferSize = ctx.sampleRate * 0.15;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.15));
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    gain.gain.setValueAtTime(this.volume * 0.4, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    noise.connect(gain);
    noise.start(now);

    // 低频冲击
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, now);
    osc.frequency.exponentialRampToValueAtTime(40, now + 0.15);
    const g2 = ctx.createGain();
    g2.connect(ctx.destination);
    g2.gain.setValueAtTime(this.volume * 0.3, now);
    g2.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc.connect(g2);
    osc.start(now);
    osc.stop(now + 0.15);
  }

  /** 近战挥砍 - 嗖嗖声 */
  _swingSound(ctx, now, gain) {
    const bufferSize = ctx.sampleRate * 0.2;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      const t = i / bufferSize;
      data[i] = (Math.random() * 2 - 1) * Math.sin(t * Math.PI) * 0.5;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(2000, now);
    filter.frequency.exponentialRampToValueAtTime(500, now + 0.15);
    filter.Q.value = 2;

    gain.gain.setValueAtTime(this.volume * 0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    noise.connect(filter);
    filter.connect(gain);
    noise.start(now);
  }

  /** 命中敌人 - 金属撞击声 */
  _hitSound(ctx, now, gain) {
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(1200, now);
    osc.frequency.exponentialRampToValueAtTime(200, now + 0.06);
    gain.gain.setValueAtTime(this.volume * 0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
    osc.connect(gain);
    osc.start(now);
    osc.stop(now + 0.08);
  }

  /** 击杀敌人 - 满足感音效 */
  _killSound(ctx, now, gain) {
    const notes = [600, 800, 1000];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      g.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + i * 0.08);
      g.gain.setValueAtTime(this.volume * 0.15, now + i * 0.08);
      g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.08 + 0.15);
      osc.connect(g);
      osc.start(now + i * 0.08);
      osc.stop(now + i * 0.08 + 0.15);
    });
  }

  /** 玩家受击 - 沉重低音 */
  _hurtSound(ctx, now, gain) {
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(200, now);
    osc.frequency.exponentialRampToValueAtTime(80, now + 0.2);
    gain.gain.setValueAtTime(this.volume * 0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    osc.connect(gain);
    osc.start(now);
    osc.stop(now + 0.25);
  }

  /** 换弹 - 机械咔嚓声 */
  _reloadSound(ctx, now, gain) {
    // 咔嚓1
    const osc1 = ctx.createOscillator();
    const g1 = ctx.createGain();
    g1.connect(ctx.destination);
    osc1.type = 'square';
    osc1.frequency.setValueAtTime(400, now);
    osc1.frequency.exponentialRampToValueAtTime(100, now + 0.05);
    g1.gain.setValueAtTime(this.volume * 0.15, now);
    g1.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
    osc1.connect(g1);
    osc1.start(now);
    osc1.stop(now + 0.06);

    // 咔嚓2
    const osc2 = ctx.createOscillator();
    const g2 = ctx.createGain();
    g2.connect(ctx.destination);
    osc2.type = 'square';
    osc2.frequency.setValueAtTime(600, now + 0.12);
    osc2.frequency.exponentialRampToValueAtTime(200, now + 0.17);
    g2.gain.setValueAtTime(this.volume * 0.15, now + 0.12);
    g2.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    osc2.connect(g2);
    osc2.start(now + 0.12);
    osc2.stop(now + 0.18);
  }

  /** 脚步声 - 轻微的踏步声 */
  _stepSound(ctx, now, gain) {
    const bufferSize = ctx.sampleRate * 0.05;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.2));
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 800;
    gain.gain.setValueAtTime(this.volume * 0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
    noise.connect(filter);
    filter.connect(gain);
    noise.start(now);
  }

  /** 方块破碎声 */
  _blockBreakSound(ctx, now, gain) {
    const bufferSize = ctx.sampleRate * 0.1;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.3));
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    gain.gain.setValueAtTime(this.volume * 0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    noise.connect(gain);
    noise.start(now);
  }

  /** 任务完成音效 */
  _questSound(ctx, now, gain) {
    const notes = [523, 659, 784, 1047];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      g.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + i * 0.1);
      g.gain.setValueAtTime(this.volume * 0.12, now + i * 0.1);
      g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.1 + 0.2);
      osc.connect(g);
      osc.start(now + i * 0.1);
      osc.stop(now + i * 0.1 + 0.2);
    });
  }

  /** 新波次音效 */
  _waveSound(ctx, now, gain) {
    const notes = [400, 500, 700, 500, 400];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      g.connect(ctx.destination);
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + i * 0.12);
      g.gain.setValueAtTime(this.volume * 0.15, now + i * 0.12);
      g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.12 + 0.15);
      osc.connect(g);
      osc.start(now + i * 0.12);
      osc.stop(now + i * 0.12 + 0.15);
    });
  }

  // === 公开接口 ===
  shoot(pitch) { this._play('shoot', { pitch }); }
  shotgun() { this._play('shotgun'); }
  swing() { this._play('swing'); }
  hit() { this._play('hit'); }
  kill() { this._play('kill'); }
  hurt() { this._play('hurt'); }
  reload() { this._play('reload'); }
  step() { this._play('step'); }
  blockBreak() { this._play('block_break'); }
  quest() { this._play('quest'); }
  wave() { this._play('wave'); }
}

// 全局单例
export const audio = new AudioManager();
