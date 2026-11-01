// WebAudio 声音：多个声音同时播放、音量、循环、音乐声道淡入淡出、预加载解码；
// 滤波器（低通/高通等）、混响、空间声音（按世界坐标和听者位置定位）、按句柄实时修改。
// 浏览器不支持 WebAudio 时退回 <audio> 元素（没有效果器）。
export interface SoundFilterOpts { type: BiquadFilterType; freq: number; q?: number; gain?: number }
export interface SoundOpts { volume?: number; loop?: boolean; channel?: string; fade_ms?: number; rate?: number; pan?: number; voice?: string; filter?: SoundFilterOpts | null; reverb?: number; x?: number; y?: number }
interface Voice { src: AudioBufferSourceNode | null; el?: HTMLAudioElement; gain: GainNode | null; id: string; channel?: string; voice?: string; base: number; filter?: BiquadFilterNode; panner?: PannerNode; stereo?: StereoPannerNode; send?: GainNode }

export class AudioEngine {
  private ctx: AudioContext | null = null; private master: GainNode | null = null;
  private buffers = new Map<string, Promise<AudioBuffer | null>>(); private ready = new Map<string, AudioBuffer>();
  private voices: Voice[] = []; private off: (() => void)[] = [];
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
  private reverbIn: GainNode | null = null; private scale = 0.01; private sfx = 1;
  /** 混响：用确定的伪随机噪声生成 2 秒衰减的冲激响应，所有声音共用一个卷积器 */
  private reverbNode(): GainNode | null {
    const ctx = this.ctx; if (!ctx || !this.master) return null;
    if (this.reverbIn) return this.reverbIn;
    try {
      const len = Math.floor(ctx.sampleRate * 2), ir = ctx.createBuffer(2, len, ctx.sampleRate); let seed = 12345;
      for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) { seed = (seed * 1103515245 + 12345) >>> 0; d[i] = ((seed / 4294967296) * 2 - 1) * Math.pow(1 - i / len, 3); } }
      const conv = ctx.createConvolver(); conv.buffer = ir;
      const inp = ctx.createGain(); inp.connect(conv); conv.connect(this.master);
      this.reverbIn = inp;
    } catch { this.reverbIn = null; }
    return this.reverbIn;
  }
  /** 空间声音的听者位置（世界坐标）；scale 把像素换算成米（默认 100 像素 = 1 米） */
  listener(x: number, y: number, scale?: number) {
    const ctx = this.ctx; if (!ctx) return;
    if (scale && scale > 0) this.scale = scale;
    const L: any = ctx.listener, X = x * this.scale, Z = y * this.scale, t = ctx.currentTime;
    if (L.positionX) { L.positionX.setTargetAtTime(X, t, 0.02); L.positionY.setTargetAtTime(0, t, 0.02); L.positionZ.setTargetAtTime(Z, t, 0.02); L.forwardX.value = 0; L.forwardY.value = 0; L.forwardZ.value = -1; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0; }
    else L.setPosition?.(X, 0, Z);
  }
  private applyFilter(v: Voice, f: SoundFilterOpts | null | undefined) {
    if (!v.filter || f === undefined) return;
    const t = this.ctx!.currentTime;
    if (f === null) { v.filter.type = "allpass"; return; }
    v.filter.type = f.type; v.filter.frequency.setTargetAtTime(f.freq, t, 0.02);
    if (f.q !== undefined) v.filter.Q.setTargetAtTime(f.q, t, 0.02); if (f.gain !== undefined) v.filter.gain.setTargetAtTime(f.gain, t, 0.02);
  }
  private place(p: PannerNode, x: number, y: number) {
    const X = x * this.scale, Z = y * this.scale, t = this.ctx!.currentTime, P: any = p;
    if (P.positionX) { P.positionX.setTargetAtTime(X, t, 0.02); P.positionY.setTargetAtTime(0, t, 0.02); P.positionZ.setTargetAtTime(Z, t, 0.02); } else P.setPosition?.(X, 0, Z);
  }
  /** 改正在播放的声音（按 voice 句柄名，或声道名） */
  set(name: string, o: SoundOpts) {
    const ctx = this.ctx; const t = ctx?.currentTime ?? 0, fade = Math.max(0, Number(o.fade_ms ?? 50)) / 1000;
    for (const v of this.voices) {
      if (v.voice !== name && v.channel !== name) continue;
      if (v.el) { if (typeof o.volume === "number") v.el.volume = Math.max(0, Math.min(1, o.volume * this.sfx)); continue; }
      if (typeof o.volume === "number" && v.gain) { v.base = Math.max(0, Math.min(4, o.volume * this.sfx)); v.gain.gain.cancelScheduledValues(t); v.gain.gain.setValueAtTime(v.gain.gain.value, t); v.gain.gain.linearRampToValueAtTime(v.base, t + Math.max(0.01, fade)); }
      if (typeof o.rate === "number" && v.src) v.src.playbackRate.setTargetAtTime(Math.max(0.25, Math.min(4, o.rate)), t, 0.02);
      if (typeof o.pan === "number" && v.stereo) v.stereo.pan.setTargetAtTime(Math.max(-1, Math.min(1, o.pan)), t, 0.02);
      if (typeof o.x === "number" && typeof o.y === "number" && v.panner) this.place(v.panner, o.x, o.y);
      if (typeof o.reverb === "number" && v.send) v.send.gain.setTargetAtTime(Math.max(0, Math.min(1, o.reverb)), t, 0.05);
      this.applyFilter(v, o.filter);
    }
  }
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
    if (o.voice) this.stopWhere((v) => v.voice === o.voice, fade); // 同一个句柄只对应一个声音
    const vol = Math.max(0, Math.min(4, volume));
    const ctx = this.ctx;
    if (!ctx) return this.playEl(id, o, vol);
    const buf = this.ready.get(id);
    if (!buf) { void this.load(id).then((b) => { if (b && (o.loop || o.channel)) this.play(id, { ...o, fade_ms: 0 }, volume); }); return; } // 短音效没解码好就跳过，避免延迟后乱响
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = !!o.loop; src.playbackRate.value = Math.max(0.25, Math.min(4, Number(o.rate ?? 1)));
    const gain = ctx.createGain(); let node: AudioNode = src;
    // 链路：声源 → 滤波器 → 定位（空间或左右声像）→ 音量 → 总音量；另有一路按 reverb 比例送进混响
    let filter: BiquadFilterNode | undefined, panner: PannerNode | undefined, stereo: StereoPannerNode | undefined, send: GainNode | undefined;
    if (o.filter || o.voice || o.channel) { filter = ctx.createBiquadFilter(); filter.type = "allpass"; node.connect(filter); node = filter; }
    if (typeof o.x === "number" && typeof o.y === "number" && ctx.createPanner) {
      panner = ctx.createPanner(); panner.panningModel = "HRTF"; panner.distanceModel = "inverse"; panner.refDistance = 1; panner.rolloffFactor = 1; panner.maxDistance = 10000;
      this.place(panner, o.x, o.y); node.connect(panner); node = panner;
    } else if ((typeof o.pan === "number" || o.voice || o.channel) && ctx.createStereoPanner) { stereo = ctx.createStereoPanner(); stereo.pan.value = Math.max(-1, Math.min(1, Number(o.pan ?? 0))); node.connect(stereo); node = stereo; }
    node.connect(gain); gain.connect(this.master!);
    if (typeof o.reverb === "number" || o.voice || o.channel) { const r = this.reverbNode(); if (r) { send = ctx.createGain(); send.gain.value = Math.max(0, Math.min(1, Number(o.reverb ?? 0))); gain.connect(send); send.connect(r); } }
    const t = ctx.currentTime;
    if (fade) { gain.gain.setValueAtTime(0, t); gain.gain.linearRampToValueAtTime(vol, t + fade); } else gain.gain.value = vol;
    const v: Voice = { src, gain, id, channel: o.channel, voice: o.voice, base: vol, filter, panner, stereo, send };
    this.applyFilter(v, o.filter ?? undefined);
    src.onended = () => { this.voices = this.voices.filter((x) => x !== v); };
    src.start();
    this.voices.push(v);
    if (this.voices.length > 48) this.kill(this.voices.find((x) => !x.src?.loop) ?? this.voices[0], 0);
  }
  private playEl(id: string, o: SoundOpts, vol: number) {
    const u = this.url(id); if (!u) return;
    const a = new Audio(u); a.volume = Math.min(1, vol); a.loop = !!o.loop;
    const v: Voice = { src: null, el: a, gain: null, id, channel: o.channel, voice: o.voice, base: vol };
    a.onended = () => { this.voices = this.voices.filter((x) => x !== v); };
    this.voices.push(v); a.play().catch(() => {});
  }
  stop(id: string | null, fadeMs = 0, voice?: string) { this.stopWhere((v) => (voice ? v.voice === voice : id === null || v.id === id), Math.max(0, fadeMs) / 1000); }
  /** 玩家的音效音量（set 改音量时也要乘上） */
  setSfx(k: number) { this.sfx = Math.max(0, k); }
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
