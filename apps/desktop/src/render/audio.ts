// WebAudio 声音：多个声音同时播放、音量、循环、音乐声道淡入淡出、预加载解码。
// 浏览器不支持 WebAudio 时退回 <audio> 元素。
export interface SoundOpts { volume?: number; loop?: boolean; channel?: string; fade_ms?: number; rate?: number; pan?: number }
interface Voice { src: AudioBufferSourceNode | null; el?: HTMLAudioElement; gain: GainNode | null; id: string; channel?: string; base: number }

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
    const gain = ctx.createGain(); let node: AudioNode = src;
    if (typeof o.pan === "number" && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, o.pan)); src.connect(p); node = p; }
    node.connect(gain); gain.connect(this.master!);
    const t = ctx.currentTime;
    if (fade) { gain.gain.setValueAtTime(0, t); gain.gain.linearRampToValueAtTime(vol, t + fade); } else gain.gain.value = vol;
    const v: Voice = { src, gain, id, channel: o.channel, base: vol };
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
