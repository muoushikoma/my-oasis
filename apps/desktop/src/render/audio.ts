// WebAudio 声音：多个声音同时播放、音量、循环、音乐声道淡入淡出、预加载解码。
// 浏览器不支持 WebAudio 时退回 <audio> 元素。
// 音效：低通/高通滤波、混响（程序生成的脉冲响应，不用额外文件）、回声；空间音效：声源位置 + 听者位置（PannerNode）。
export interface SoundOpts {
  volume?: number; loop?: boolean; channel?: string; fade_ms?: number; rate?: number; pan?: number;
  lowpass?: number; highpass?: number; q?: number; reverb?: number; reverb_s?: number; delay_ms?: number; delay_feedback?: number; delay_mix?: number;
  x?: number; y?: number; spatial?: boolean; ref_distance?: number; max_distance?: number; rolloff?: number;
}
interface Voice { src: AudioBufferSourceNode | null; el?: HTMLAudioElement; gain: GainNode | null; id: string; channel?: string; base: number; panner?: PannerNode }
const cl = (v: any, lo: number, hi: number, d: number) => (typeof v === "number" && isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
/** 空间音效的单位换算：画面里 100 像素 = 1 米 */
const UNIT = 100;

export class AudioEngine {
  private ctx: AudioContext | null = null; private master: GainNode | null = null;
  private buffers = new Map<string, Promise<AudioBuffer | null>>(); private ready = new Map<string, AudioBuffer>();
  private voices: Voice[] = []; private off: (() => void)[] = [];
  private irs = new Map<number, AudioBuffer>();
  /** 听者位置（api.sound.listener） */
  listener(x: number, y: number) {
    const ctx = this.ctx; if (!ctx) return; const L: any = ctx.listener, X = x / UNIT, Y = y / UNIT, t = ctx.currentTime;
    if (L.positionX) { L.positionX.setTargetAtTime(X, t, 0.02); L.positionY.setTargetAtTime(Y, t, 0.02); L.positionZ.setTargetAtTime(1, t, 0.02); } else L.setPosition?.(X, Y, 1);
    // 听者在画面上方 1 米、朝向画面（-z）；右边（+x）的声音在右声道
    if (L.forwardX) { L.forwardX.value = 0; L.forwardY.value = 0; L.forwardZ.value = -1; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0; } else L.setOrientation?.(0, 0, -1, 0, 1, 0);
  }
  /** 移动声源（api.sound.move）：同 id 正在播放的声音都跟着动 */
  move(id: string, x: number, y: number) {
    const ctx = this.ctx; if (!ctx) return;
    for (const v of this.voices) if (v.id === id && v.panner) { const p: any = v.panner, t = ctx.currentTime; if (p.positionX) { p.positionX.setTargetAtTime(x / UNIT, t, 0.02); p.positionY.setTargetAtTime(y / UNIT, t, 0.02); } else p.setPosition(x / UNIT, y / UNIT, 0); }
  }
  /** 混响用的脉冲响应：确定性的衰减噪声（按秒数缓存） */
  private ir(seconds: number): AudioBuffer {
    const ctx = this.ctx!, key = Math.round(seconds * 10) / 10; let b = this.irs.get(key); if (b) return b;
    const n = Math.max(1, Math.floor(ctx.sampleRate * key)); b = ctx.createBuffer(2, n, ctx.sampleRate);
    let seed = 0x2545f491;
    for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < n; i++) { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; d[i] = ((seed >>> 0) / 4294967296 * 2 - 1) * Math.pow(1 - i / n, 3); } }
    this.irs.set(key, b); return b;
  }
  /** 按选项串起效果链：源 → 滤波 → (干声 + 混响 + 回声) → 声像/空间 → 音量 */
  private chain(ctx: AudioContext, src: AudioNode, o: SoundOpts): { out: AudioNode; panner?: PannerNode } {
    let node = src;
    if (typeof o.lowpass === "number") { const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = cl(o.lowpass, 20, 20000, 20000); f.Q.value = cl(o.q, 0.0001, 30, 0.7); node.connect(f); node = f; }
    if (typeof o.highpass === "number") { const f = ctx.createBiquadFilter(); f.type = "highpass"; f.frequency.value = cl(o.highpass, 20, 20000, 20); f.Q.value = cl(o.q, 0.0001, 30, 0.7); node.connect(f); node = f; }
    const rv = cl(o.reverb, 0, 1, 0), dm = cl(o.delay_mix, 0, 1, o.delay_ms ? 0.4 : 0);
    if (rv > 0 || (o.delay_ms && dm > 0)) {
      const mix = ctx.createGain(); const dry = ctx.createGain(); dry.gain.value = 1 - Math.max(rv, dm) * 0.5; node.connect(dry); dry.connect(mix);
      if (rv > 0) { const cv = ctx.createConvolver(); cv.buffer = this.ir(cl(o.reverb_s, 0.1, 8, 2)); const wet = ctx.createGain(); wet.gain.value = rv; node.connect(cv); cv.connect(wet); wet.connect(mix); }
      if (o.delay_ms && dm > 0) {
        const d = ctx.createDelay(5); d.delayTime.value = cl(o.delay_ms, 1, 5000, 250) / 1000;
        const fb = ctx.createGain(); fb.gain.value = cl(o.delay_feedback, 0, 0.9, 0.35); const wet = ctx.createGain(); wet.gain.value = dm;
        node.connect(d); d.connect(fb); fb.connect(d); d.connect(wet); wet.connect(mix);
      }
      node = mix;
    }
    let panner: PannerNode | undefined;
    if (o.spatial || typeof o.x === "number" || typeof o.y === "number") {
      panner = ctx.createPanner(); panner.panningModel = "HRTF"; panner.distanceModel = "inverse";
      panner.refDistance = cl(o.ref_distance, 1, 100000, 200) / UNIT; panner.maxDistance = cl(o.max_distance, 1, 1000000, 10000) / UNIT; panner.rolloffFactor = cl(o.rolloff, 0, 10, 1);
      const p: any = panner, X = cl(o.x, -1e6, 1e6, 0) / UNIT, Y = cl(o.y, -1e6, 1e6, 0) / UNIT;
      if (p.positionX) { p.positionX.value = X; p.positionY.value = Y; p.positionZ.value = 0; } else p.setPosition(X, Y, 0);
      node.connect(panner); node = panner;
    } else if (typeof o.pan === "number" && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, o.pan)); node.connect(p); node = p; }
    return { out: node, panner };
  }
  constructor(private url: (id: string) => string | undefined, private bytes: (id: string) => Uint8Array | undefined) {
    const AC: typeof AudioContext | undefined = (globalThis as any).AudioContext ?? (globalThis as any).webkitAudioContext;
    if (AC) {
      try { this.ctx = new AC(); this.master = this.ctx.createGain(); this.master.connect(this.ctx.destination); } catch { this.ctx = null; }
      // 浏览器要求用户操作后才能出声：第一次点击/按键时恢复
      const resume = () => { void this.ctx?.resume(); };
      for (const ev of ["pointerdown", "keydown", "touchstart"]) { window.addEventListener(ev, resume, { passive: true }); this.off.push(() => window.removeEventListener(ev, resume)); }
    }
  }
  get webaudio() { return !!this.ctx; }
  /** 解码一个声音（可提前调用做预加载） */
  load(id: string): Promise<AudioBuffer | null> {
    let p = this.buffers.get(id);
    if (!p) {
      const b = this.bytes(id);
      p = !this.ctx || !b ? Promise.resolve(null) : this.ctx.decodeAudioData(b.slice().buffer).then((buf) => { this.ready.set(id, buf); return buf; }).catch(() => null);
      this.buffers.set(id, p);
    }
    return p;
  }
  setMaster(v: number) { if (this.master && this.ctx) this.master.gain.setTargetAtTime(Math.max(0, v), this.ctx.currentTime, 0.02); }

  play(id: string, o: SoundOpts, volume: number) {
    const fade = Math.max(0, Number(o.fade_ms ?? (o.channel ? 600 : 0))) / 1000;
    // 同一声道（例如 music）同时只放一个：旧的淡出、新的淡入
    if (o.channel) this.stopWhere((v) => v.channel === o.channel, fade);
    if (o.loop) this.stopWhere((v) => v.id === id && !!v.src?.loop, fade);
    const vol = Math.max(0, Math.min(4, volume));
    const ctx = this.ctx;
    if (!ctx) return this.playEl(id, o, vol);
    const buf = this.ready.get(id);
    if (!buf) { void this.load(id).then((b) => { if (b && (o.loop || o.channel)) this.play(id, { ...o, fade_ms: 0 }, volume); }); return; } // 短音效没解码好就跳过，避免延迟后乱响
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = !!o.loop; src.playbackRate.value = Math.max(0.25, Math.min(4, Number(o.rate ?? 1)));
    const gain = ctx.createGain(); const { out, panner } = this.chain(ctx, src, o);
    out.connect(gain); gain.connect(this.master!);
    const t = ctx.currentTime;
    if (fade) { gain.gain.setValueAtTime(0, t); gain.gain.linearRampToValueAtTime(vol, t + fade); } else gain.gain.value = vol;
    const v: Voice = { src, gain, id, channel: o.channel, base: vol, panner };
    src.onended = () => { this.voices = this.voices.filter((x) => x !== v); };
    src.start();
    this.voices.push(v);
    if (this.voices.length > 48) this.kill(this.voices.find((x) => !x.src?.loop) ?? this.voices[0], 0);
  }
  private playEl(id: string, o: SoundOpts, vol: number) {
    const u = this.url(id); if (!u) return;
    const a = new Audio(u); a.volume = Math.min(1, vol); a.loop = !!o.loop;
    const v: Voice = { src: null, el: a, gain: null, id, channel: o.channel, base: vol };
    a.onended = () => { this.voices = this.voices.filter((x) => x !== v); };
    this.voices.push(v); a.play().catch(() => {});
  }
  stop(id: string | null, fadeMs = 0) { this.stopWhere((v) => id === null || v.id === id, Math.max(0, fadeMs) / 1000); }
  private stopWhere(f: (v: Voice) => boolean, fade: number) { for (const v of this.voices.filter(f)) this.kill(v, fade); }
  private kill(v: Voice, fade: number) {
    this.voices = this.voices.filter((x) => x !== v);
    if (v.el) { v.el.pause(); return; }
    const ctx = this.ctx!; const t = ctx.currentTime;
    try {
      if (fade && v.gain) { v.gain.gain.cancelScheduledValues(t); v.gain.gain.setValueAtTime(v.gain.gain.value, t); v.gain.gain.linearRampToValueAtTime(0, t + fade); v.src!.stop(t + fade + 0.02); }
      else v.src!.stop();
    } catch { /* 已经停了 */ }
  }
  dispose() { this.stop(null); this.off.forEach((f) => f()); this.off = []; void this.ctx?.close().catch(() => {}); this.ctx = null; }
}
