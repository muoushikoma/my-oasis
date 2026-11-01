// 游戏运行时（规范 §13.6，组件写 runtime: game 时由客户端注入到自定义组件的沙箱 iframe 里）。
// 提供 window.oasis.game：固定步长循环、场景/实体、素材预加载、音频、PixiJS 渲染（精灵、图集动画、九宫格、粒子、镜头）、
// Rapier 2D 物理（刚体、碰撞体、传感器、碰撞事件、射线、角色控制器）、JSON 动画状态机、统一输入、在实时循环外调用 AI 的辅助函数。
// 全部内联在文档里，不联网；PixiJS 用 unsafe-eval 替代模块，不需要 eval（沙箱 CSP 只多开了 'wasm-unsafe-eval' 给 Rapier）。
import "pixi.js/unsafe-eval";
import * as PIXI from "pixi.js";
import RAPIER from "@dimforge/rapier2d-compat";
import { AnimFsm, checkFsm, compileCond, type AnimClip, type FsmDef } from "./fsm";
import { InputMap, bindDom, readNativePad, DEFAULT_BINDINGS, type Bindings, type TouchConfig } from "./input";
import { FixedLoop } from "./loop";

export const RUNTIME_VERSION = "oasis-game/1";
const BRIDGE = "oasis-ui/1";
const W = window as any;

// ---------------- 素材 ----------------
export interface SheetDef { image: string; frameWidth?: number; frameHeight?: number; margin?: number; spacing?: number; animations?: Record<string, AnimClip>; atlas?: string }
export interface Manifest { images?: Record<string, string>; sheets?: Record<string, SheetDef | string>; sounds?: Record<string, string>; json?: Record<string, string>; fonts?: Record<string, string> }
export interface Sheet { texture: PIXI.Texture; frames: PIXI.Texture[]; named: Record<string, PIXI.Texture>; animations: Record<string, AnimClip>; frameWidth: number; frameHeight: number }

const b64ToBytes = (s: string) => { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
function fileUrl(path: string): string {
  const u = W.oasis?.files?.[path.replace(/^\.?\//, "")];
  if (!u) throw new Error(`素材「${path}」没打包进组件：在组件的 files 里列出它（或它所在的文件夹）`);
  return u;
}
function fileBytes(path: string): Uint8Array { const u = fileUrl(path); return b64ToBytes(u.slice(u.indexOf(",") + 1)); }
function fileText(path: string): string { return new TextDecoder().decode(fileBytes(path)); }
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error("图片加载失败")); i.src = src; });
}

class Assets {
  textures: Record<string, PIXI.Texture> = {}; sheets: Record<string, Sheet> = {}; data: Record<string, any> = {};
  constructor(private audio: Audio) {}
  async load(m: Manifest, onProgress?: (p: number) => void) {
    const jobs: (() => Promise<void>)[] = [];
    for (const [id, p] of Object.entries(m.images ?? {})) jobs.push(async () => { this.textures[id] = await this.texture(p); });
    for (const [id, p] of Object.entries(m.json ?? {})) jobs.push(async () => { this.data[id] = JSON.parse(fileText(p)); });
    for (const [id, p] of Object.entries(m.sounds ?? {})) jobs.push(async () => { await this.audio.load(id, fileBytes(p)); });
    for (const [id, p] of Object.entries(m.fonts ?? {})) jobs.push(async () => { const f = new FontFace(id, `url(${fileUrl(p)})`); await f.load(); (document as any).fonts.add(f); });
    for (const [id, d] of Object.entries(m.sheets ?? {})) jobs.push(async () => { this.sheets[id] = await this.sheet(typeof d === "string" ? JSON.parse(fileText(d)) : d); });
    let done = 0;
    await Promise.all(jobs.map((j) => j().then(() => onProgress?.(++done / jobs.length))));
  }
  async texture(path: string) { const t = PIXI.Texture.from(await loadImage(fileUrl(path))); t.source.scaleMode = "nearest"; return t; }
  async sheet(d: SheetDef): Promise<Sheet> {
    const base = await this.texture(d.image), frames: PIXI.Texture[] = [], named: Record<string, PIXI.Texture> = {};
    let fw = d.frameWidth ?? base.width, fh = d.frameHeight ?? base.height;
    if (d.atlas) {
      // TexturePacker / Aseprite 风格的 JSON：{ frames: { 名字: { frame: {x,y,w,h} } } 或 [ { filename, frame } ] }
      const a = JSON.parse(fileText(d.atlas)); const list = Array.isArray(a.frames) ? a.frames.map((f: any) => [f.filename, f]) : Object.entries(a.frames);
      for (const [name, f] of list as [string, any][]) { const r = f.frame; const t = new PIXI.Texture({ source: base.source, frame: new PIXI.Rectangle(r.x, r.y, r.w, r.h) }); frames.push(t); named[name] = t; fw = r.w; fh = r.h; }
    } else {
      const m = d.margin ?? 0, s = d.spacing ?? 0;
      for (let y = m; y + fh <= base.height; y += fh + s) for (let x = m; x + fw <= base.width; x += fw + s)
        frames.push(new PIXI.Texture({ source: base.source, frame: new PIXI.Rectangle(x, y, fw, fh) }));
    }
    return { texture: base, frames, named, animations: d.animations ?? { default: { frames: frames.map((_, i) => i), fps: 10 } }, frameWidth: fw, frameHeight: fh };
  }
  json(id: string) { return this.data[id]; }
}

// ---------------- 音频（Web Audio，素材直接解码，不走网络） ----------------
class Audio {
  ctx?: AudioContext; buffers: Record<string, AudioBuffer> = {}; pending: Record<string, Uint8Array> = {};
  master?: GainNode; musicNode?: { src: AudioBufferSourceNode; gain: GainNode; id: string };
  volume = 1; musicVolume = 0.6; sfxVolume = 1; muted = false;
  private ensure() {
    if (!this.ctx) { try { this.ctx = new AudioContext(); this.master = this.ctx.createGain(); this.master.connect(this.ctx.destination); } catch { return; } }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }
  /** 浏览器要求先有一次用户操作才能出声；运行时在第一次按键/点击时自动调用 */
  unlock() { const c = this.ensure(); if (!c) return; for (const [id, b] of Object.entries(this.pending)) { delete this.pending[id]; void this.decode(id, b); } }
  async load(id: string, bytes: Uint8Array) { this.pending[id] = bytes; if (this.ctx) { delete this.pending[id]; await this.decode(id, bytes); } }
  private async decode(id: string, b: Uint8Array) { try { this.buffers[id] = await this.ctx!.decodeAudioData(b.slice().buffer); } catch { console.warn(`声音「${id}」解码失败`); } }
  play(id: string, o: { volume?: number; rate?: number; loop?: boolean; detune?: number } = {}) {
    const c = this.ensure(), buf = this.buffers[id]; if (!c || !buf || this.muted) return;
    const src = c.createBufferSource(); src.buffer = buf; src.loop = !!o.loop; src.playbackRate.value = o.rate ?? 1; if (o.detune) src.detune.value = o.detune;
    const g = c.createGain(); g.gain.value = (o.volume ?? 1) * this.sfxVolume * this.volume; src.connect(g).connect(this.master!); src.start();
    return { stop: () => { try { src.stop(); } catch { /* 已停 */ } } };
  }
  music(id: string | null, o: { volume?: number } = {}) {
    if (this.musicNode?.id === id) return;
    if (this.musicNode) { try { this.musicNode.src.stop(); } catch { /* 已停 */ } this.musicNode = undefined; }
    const c = this.ensure(); if (!id || !c || !this.buffers[id]) return;
    const src = c.createBufferSource(); src.buffer = this.buffers[id]; src.loop = true;
    const g = c.createGain(); g.gain.value = (o.volume ?? 1) * this.musicVolume * this.volume; src.connect(g).connect(this.master!); src.start();
    this.musicNode = { src, gain: g, id };
  }
  setMuted(m: boolean) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : 1; }
}

// ---------------- 物理（Rapier，单位：对外一律像素） ----------------
export interface ShapeDef { box?: [number, number]; circle?: number; capsule?: [number, number]; offset?: [number, number] }
export interface ColliderOpts extends ShapeDef { sensor?: boolean; friction?: number; restitution?: number; density?: number; layer?: string; mask?: string[]; name?: string; enabled?: boolean }
export interface BodyOpts extends ColliderOpts { type?: "dynamic" | "fixed" | "kinematic"; lockRotation?: boolean; gravityScale?: number; ccd?: boolean; linearDamping?: number }
export interface RayHit { entity?: Entity; collider: RAPIER.Collider; point: { x: number; y: number }; normal: { x: number; y: number }; distance: number }

class Physics {
  world: RAPIER.World; events = new RAPIER.EventQueue(true); layers: string[];
  owner = new Map<number, { entity?: Entity; name?: string }>();
  private listeners = new Set<(a: CollisionInfo, b: CollisionInfo, started: boolean) => void>();
  constructor(readonly scale: number, gravity: { x: number; y: number }, layers: string[]) {
    this.world = new RAPIER.World({ x: gravity.x / scale, y: gravity.y / scale });
    this.layers = layers.length ? layers.slice(0, 16) : ["default"];
  }
  groupsFor(layer?: string, mask?: string[]) { return this.groups(layer, mask); }
  private groups(layer?: string, mask?: string[]) {
    const bit = (n: string) => { const i = this.layers.indexOf(n); if (i < 0) throw new Error(`没有声明物理层「${n}」（create 的 physics.layers）`); return 1 << i; };
    const member = layer ? bit(layer) : 0xffff, filter = mask ? mask.reduce((a, n) => a | bit(n), 0) : 0xffff;
    return ((member & 0xffff) << 16) | (filter & 0xffff);
  }
  colliderDesc(o: ColliderOpts) {
    const s = this.scale; let d: RAPIER.ColliderDesc;
    if (o.circle !== undefined) d = RAPIER.ColliderDesc.ball(o.circle / s);
    else if (o.capsule) d = RAPIER.ColliderDesc.capsule(o.capsule[1] / 2 / s, o.capsule[0] / 2 / s);
    else { const [w, h] = o.box ?? [16, 16]; d = RAPIER.ColliderDesc.cuboid(w / 2 / s, h / 2 / s); }
    if (o.offset) d.setTranslation(o.offset[0] / s, o.offset[1] / s);
    if (o.sensor) d.setSensor(true);
    if (o.friction !== undefined) d.setFriction(o.friction);
    if (o.restitution !== undefined) d.setRestitution(o.restitution);
    if (o.density !== undefined) d.setDensity(o.density);
    d.setCollisionGroups(this.groups(o.layer, o.mask));
    d.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    d.setActiveCollisionTypes(RAPIER.ActiveCollisionTypes.DEFAULT | RAPIER.ActiveCollisionTypes.KINEMATIC_FIXED | RAPIER.ActiveCollisionTypes.KINEMATIC_KINEMATIC);
    return d;
  }
  body(x: number, y: number, o: BodyOpts) {
    const s = this.scale;
    const d = o.type === "fixed" ? RAPIER.RigidBodyDesc.fixed() : o.type === "kinematic" ? RAPIER.RigidBodyDesc.kinematicPositionBased() : RAPIER.RigidBodyDesc.dynamic();
    d.setTranslation(x / s, y / s);
    if (o.lockRotation !== false && o.type !== "fixed") d.lockRotations();
    if (o.gravityScale !== undefined) d.setGravityScale(o.gravityScale);
    if (o.ccd) d.setCcdEnabled(true);
    if (o.linearDamping !== undefined) d.setLinearDamping(o.linearDamping);
    return this.world.createRigidBody(d);
  }
  addCollider(o: ColliderOpts, body?: RAPIER.RigidBody, entity?: Entity, at?: { x: number; y: number }) {
    const d = this.colliderDesc(o);
    if (!body && at) d.setTranslation(at.x / this.scale + (o.offset?.[0] ?? 0) / this.scale, at.y / this.scale + (o.offset?.[1] ?? 0) / this.scale);
    const c = this.world.createCollider(d, body);
    if (o.enabled === false) c.setEnabled(false);
    this.owner.set(c.handle, { entity, name: o.name });
    return c;
  }
  /** 一个不属于任何实体的静态碰撞盒（地面、墙）：x/y 是盒子中心 */
  static(x: number, y: number, o: ColliderOpts) { return this.addCollider(o, undefined, undefined, { x, y }); }
  remove(c: RAPIER.Collider) { this.owner.delete(c.handle); try { this.world.removeCollider(c, false); } catch { /* 已删 */ } }
  onCollision(cb: (a: CollisionInfo, b: CollisionInfo, started: boolean) => void) { this.listeners.add(cb); return () => this.listeners.delete(cb); }
  info(h: number): CollisionInfo { const o = this.owner.get(h); return { entity: o?.entity, name: o?.name, collider: this.world.getCollider(h), sensor: !!this.world.getCollider(h)?.isSensor() }; }
  step() {
    this.world.step(this.events);
    this.events.drainCollisionEvents((h1, h2, started) => {
      const a = this.info(h1), b = this.info(h2);
      if (!a.collider || !b.collider) return;
      this.listeners.forEach((l) => l(a, b, started));
      if (a.entity && !a.entity.dead) a.entity.onHit?.(b, started, a);
      if (b.entity && !b.entity.dead) b.entity.onHit?.(a, started, b);
    });
  }
  /** 射线：从 (x,y) 朝 (dx,dy) 方向最多 max 像素；返回第一个碰到的东西 */
  raycast(x: number, y: number, dx: number, dy: number, max: number, o: { exclude?: Entity; mask?: string[]; sensors?: boolean } = {}): RayHit | null {
    const s = this.scale, l = Math.hypot(dx, dy) || 1;
    const ray = new RAPIER.Ray({ x: x / s, y: y / s }, { x: dx / l, y: dy / l });
    const flags = o.sensors ? undefined : RAPIER.QueryFilterFlags.EXCLUDE_SENSORS;
    const groups = o.mask ? this.groups(undefined, o.mask) : undefined;
    const hit = this.world.castRayAndGetNormal(ray, max / s, true, flags, groups, undefined, o.exclude?.body);
    if (!hit) return null;
    const p = ray.pointAt(hit.timeOfImpact);
    return { entity: this.owner.get(hit.collider.handle)?.entity, collider: hit.collider, point: { x: p.x * s, y: p.y * s }, normal: { x: hit.normal.x, y: hit.normal.y }, distance: hit.timeOfImpact * s };
  }
  /** 区域查询：矩形里有哪些实体（攻击判定、范围伤害） */
  overlapBox(cx: number, cy: number, w: number, h: number, o: { mask?: string[] } = {}): Entity[] {
    const s = this.scale, out = new Set<Entity>();
    const shape = new RAPIER.Cuboid(w / 2 / s, h / 2 / s);
    this.world.intersectionsWithShape({ x: cx / s, y: cy / s }, 0, shape, (c) => { const e = this.owner.get(c.handle)?.entity; if (e) out.add(e); return true; }, undefined, o.mask ? this.groups(undefined, o.mask) : undefined);
    return [...out];
  }
}
export interface CollisionInfo { entity?: Entity; name?: string; collider: RAPIER.Collider; sensor: boolean }

// ---------------- 实体 ----------------
export interface SpawnOpts {
  x?: number; y?: number; tags?: string[]; layer?: "world" | "hud" | string;
  /** 静态贴图：images 里的 id，或 { sheet, frame } */
  sprite?: string | { sheet: string; frame?: number | string };
  /** 动画：sheet id + 状态机（对象，或 json 素材 id） */
  anim?: { sheet: string; fsm?: FsmDef | string; clip?: string };
  anchor?: [number, number];
  body?: BodyOpts;
  /** 额外的碰撞体（攻击判定、脚底传感器…）；name 用来开关 */
  colliders?: ColliderOpts[];
  /** 角色控制器（平台跳跃/俯视角移动推荐）：body 会变成运动学刚体 */
  character?: { offset?: number; snapToGround?: number; maxSlope?: number; autostep?: [number, number]; /** 移动时会被哪些层挡住（默认全部非传感器） */ mask?: string[] };
  data?: Record<string, any>;
  update?: (e: Entity, dt: number) => void;
  onHit?: (other: CollisionInfo, started: boolean, mine: CollisionInfo) => void;
  z?: number;
}

export class Entity {
  static next = 1;
  readonly id = Entity.next++;
  x: number; y: number; vx = 0; vy = 0; facing = 1; dead = false; grounded = false;
  tags: Set<string>; data: Record<string, any>;
  view: PIXI.Container; sprite?: PIXI.Sprite; sheet?: Sheet; fsm?: AnimFsm;
  body?: RAPIER.RigidBody; colliders: RAPIER.Collider[] = []; cc?: RAPIER.KinematicCharacterController; ccGroups?: number;
  update?: (e: Entity, dt: number) => void;
  onHit?: (other: CollisionInfo, started: boolean, mine: CollisionInfo) => void;
  flashT = 0;
  constructor(readonly game: Game, o: SpawnOpts) {
    this.x = o.x ?? 0; this.y = o.y ?? 0; this.tags = new Set(o.tags ?? []); this.data = { ...(o.data ?? {}) };
    this.update = o.update; this.onHit = o.onHit;
    this.view = new PIXI.Container(); this.view.zIndex = o.z ?? 0;
    const anchor = o.anchor ?? [0.5, 0.5];
    if (o.anim) {
      const sh = game.assets.sheets[o.anim.sheet]; if (!sh) throw new Error(`没有图集「${o.anim.sheet}」`);
      this.sheet = sh; this.sprite = new PIXI.Sprite(sh.frames[0]);
      const fsmDef = typeof o.anim.fsm === "string" ? game.assets.json(o.anim.fsm) : o.anim.fsm;
      const def: FsmDef = fsmDef ?? { initial: o.anim.clip ?? Object.keys(sh.animations)[0], states: { [o.anim.clip ?? Object.keys(sh.animations)[0]]: {} } };
      this.fsm = new AnimFsm(def, sh.animations);
      this.fsm.on((ev) => this.game.emitEntityEvent(this, ev.name, ev));
    } else if (o.sprite) {
      const t = typeof o.sprite === "string" ? game.assets.textures[o.sprite] : (() => { const sh = game.assets.sheets[o.sprite.sheet]; const f = o.sprite.frame ?? 0; return typeof f === "string" ? sh?.named[f] : sh?.frames[f]; })();
      if (!t) throw new Error(`找不到贴图 ${JSON.stringify(o.sprite)}`);
      this.sprite = new PIXI.Sprite(t);
    }
    if (this.sprite) { this.sprite.anchor.set(anchor[0], anchor[1]); this.view.addChild(this.sprite); }
    const ph = game.physics;
    if (o.body || o.character) {
      const bo: BodyOpts = { ...(o.body ?? {}), type: o.character ? "kinematic" : o.body?.type };
      this.body = ph.body(this.x, this.y, bo);
      this.colliders.push(ph.addCollider(bo, this.body, this));
      if (o.character) {
        const cc = ph.world.createCharacterController((o.character.offset ?? 0.5) / ph.scale);
        cc.setUp({ x: 0, y: -1 });
        if (o.character.snapToGround !== 0) cc.enableSnapToGround((o.character.snapToGround ?? 4) / ph.scale);
        cc.setMaxSlopeClimbAngle(((o.character.maxSlope ?? 45) * Math.PI) / 180);
        if (o.character.autostep) cc.enableAutostep(o.character.autostep[0] / ph.scale, o.character.autostep[1] / ph.scale, false);
        cc.setApplyImpulsesToDynamicBodies(true);
        this.cc = cc; if (o.character.mask) this.ccGroups = ph.groupsFor(undefined, o.character.mask);
      }
    }
    for (const c of o.colliders ?? []) this.colliders.push(ph.addCollider(c, this.body, this, this.body ? undefined : { x: this.x, y: this.y }));
    this.syncView();
  }
  has(tag: string) { return this.tags.has(tag); }
  /** 按名字找额外碰撞体，开/关（比如攻击帧打开 hitbox） */
  collider(name: string) { return this.colliders.find((c) => this.game.physics.owner.get(c.handle)?.name === name); }
  enable(name: string, on = true) { this.collider(name)?.setEnabled(on); }
  /** 角色控制器移动（像素/步）；自动处理墙、地面、坡；返回是否着地 */
  move(dx: number, dy: number) {
    const s = this.game.physics.scale;
    if (!this.cc || !this.body) { this.x += dx; this.y += dy; if (this.body) this.body.setNextKinematicTranslation({ x: this.x / s, y: this.y / s }); return false; }
    this.cc.computeColliderMovement(this.colliders[0], { x: dx / s, y: dy / s }, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, this.ccGroups);
    const m = this.cc.computedMovement(), p = this.body.translation();
    this.body.setNextKinematicTranslation({ x: p.x + m.x, y: p.y + m.y });
    this.grounded = this.cc.computedGrounded();
    // 撞到墙/天花板时把对应速度清零
    if (Math.abs(m.y * s) < Math.abs(dy) - 0.01 && dy < 0) this.vy = Math.max(this.vy, 0);
    return this.grounded;
  }
  /** 设置位置（传送） */
  setPosition(x: number, y: number) { this.x = x; this.y = y; if (this.body) { const s = this.game.physics.scale; this.body.setTranslation({ x: x / s, y: y / s }, true); } }
  impulse(ix: number, iy: number) { this.body?.applyImpulse({ x: ix / this.game.physics.scale, y: iy / this.game.physics.scale }, true); }
  velocity(vx?: number, vy?: number) { const s = this.game.physics.scale; if (!this.body) return { x: this.vx, y: this.vy }; const v = this.body.linvel(); if (vx !== undefined || vy !== undefined) this.body.setLinvel({ x: vx !== undefined ? vx / s : v.x, y: vy !== undefined ? vy / s : v.y }, true); const n = this.body.linvel(); return { x: n.x * s, y: n.y * s }; }
  /** 受击闪白 */
  flash(ms = 80) { this.flashT = ms / 1000; }
  syncFromBody() { if (this.body) { const p = this.body.translation(), s = this.game.physics.scale; this.x = p.x * s; this.y = p.y * s; } }
  syncView() {
    this.view.position.set(Math.round(this.x), Math.round(this.y));
    if (this.sprite) {
      this.sprite.scale.x = Math.abs(this.sprite.scale.x) * (this.facing < 0 ? -1 : 1);
      if (this.fsm && this.sheet) { const t = this.sheet.frames[this.fsm.textureIndex]; if (t && this.sprite.texture !== t) this.sprite.texture = t; }
      this.sprite.tint = this.flashT > 0 ? 0xff6666 : 0xffffff;
      this.sprite.alpha = this.flashT > 0 && Math.floor(this.flashT * 40) % 2 ? 0.6 : 1;
    }
  }
  destroy() {
    if (this.dead) return; this.dead = true;
    for (const c of this.colliders) this.game.physics.remove(c);
    if (this.body) { try { this.game.physics.world.removeRigidBody(this.body); } catch { /* 已删 */ } }
    if (this.cc) { try { this.game.physics.world.removeCharacterController(this.cc); } catch { /* 已删 */ } }
    this.view.destroy({ children: true });
    this.game.entities.delete(this);
  }
}

// ---------------- 镜头 ----------------
class Camera {
  x = 0; y = 0; zoom = 1; target?: Entity; lerp = 0.15; deadzone = { w: 0, h: 0 }; bounds?: { x: number; y: number; w: number; h: number };
  private shakeT = 0; private shakeDur = 0; private shakeAmp = 0; ox = 0; oy = 0;
  constructor(private game: Game) {}
  follow(e: Entity | undefined, o: { lerp?: number; deadzone?: [number, number] } = {}) { this.target = e; if (o.lerp !== undefined) this.lerp = o.lerp; if (o.deadzone) this.deadzone = { w: o.deadzone[0], h: o.deadzone[1] }; if (e) { this.x = e.x; this.y = e.y; } }
  setBounds(x: number, y: number, w: number, h: number) { this.bounds = { x, y, w, h }; }
  shake(amp = 4, ms = 200) { if (amp >= this.shakeAmp || this.shakeT <= 0) { this.shakeAmp = amp; this.shakeDur = this.shakeT = ms / 1000; } }
  update(realDt: number) {
    const t = this.target;
    if (t && !t.dead) {
      const dx = t.x - this.x, dy = t.y - this.y, hw = this.deadzone.w / 2, hh = this.deadzone.h / 2;
      const tx = Math.abs(dx) > hw ? dx - Math.sign(dx) * hw : 0, ty = Math.abs(dy) > hh ? dy - Math.sign(dy) * hh : 0;
      const k = 1 - Math.pow(1 - this.lerp, realDt * 60);
      this.x += tx * k; this.y += ty * k;
    }
    const vw = this.game.width / this.zoom, vh = this.game.height / this.zoom, b = this.bounds;
    if (b) { this.x = b.w <= vw ? b.x + b.w / 2 : Math.min(Math.max(this.x, b.x + vw / 2), b.x + b.w - vw / 2); this.y = b.h <= vh ? b.y + b.h / 2 : Math.min(Math.max(this.y, b.y + vh / 2), b.y + b.h - vh / 2); }
    if (this.shakeT > 0) { this.shakeT -= realDt; const k = Math.max(this.shakeT / this.shakeDur, 0) * this.shakeAmp; this.ox = (Math.random() * 2 - 1) * k; this.oy = (Math.random() * 2 - 1) * k; } else { this.ox = this.oy = 0; }
  }
  /** 屏幕坐标（逻辑像素）→ 世界坐标 */
  toWorld(sx: number, sy: number) { return { x: this.x + (sx - this.game.width / 2) / this.zoom, y: this.y + (sy - this.game.height / 2) / this.zoom }; }
}

// ---------------- 粒子 ----------------
interface Particle { s: PIXI.Sprite; sx: number; sy: number; vx: number; vy: number; life: number; max: number; g: number; drag: number; shrink: boolean }
class Particles {
  list: Particle[] = []; layer = new PIXI.Container(); white: PIXI.Texture;
  constructor(private game: Game) { this.white = PIXI.Texture.WHITE; this.layer.zIndex = 1000; }
  burst(o: { x: number; y: number; count?: number; color?: number | number[]; texture?: string; speed?: [number, number] | number; angle?: [number, number]; life?: [number, number] | number; gravity?: number; size?: [number, number] | number; drag?: number; shrink?: boolean }) {
    const r = (v: [number, number] | number | undefined, d: number) => Array.isArray(v) ? v[0] + Math.random() * (v[1] - v[0]) : v ?? d;
    const n = Math.min(o.count ?? 10, 300);
    for (let i = 0; i < n && this.list.length < 2000; i++) {
      const tex = o.texture ? this.game.assets.textures[o.texture] ?? this.white : this.white;
      const s = new PIXI.Sprite(tex); s.anchor.set(0.5); const sz = r(o.size, 2); if (tex === this.white) s.width = s.height = sz; else s.scale.set(sz);
      const colors = Array.isArray(o.color) ? o.color : [o.color ?? 0xffffff]; s.tint = colors[(Math.random() * colors.length) | 0];
      s.position.set(o.x, o.y);
      const ang = (r(o.angle, 0) + (o.angle ? 0 : Math.random() * 360)) * (Math.PI / 180), sp = r(o.speed, 60), life = r(o.life, 0.5);
      this.list.push({ s, sx: s.scale.x, sy: s.scale.y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life, max: life, g: o.gravity ?? 0, drag: o.drag ?? 0, shrink: o.shrink ?? true });
      this.layer.addChild(s);
    }
  }
  update(dt: number) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i]; p.life -= dt;
      if (p.life <= 0) { p.s.destroy(); this.list.splice(i, 1); continue; }
      p.vy += p.g * dt; p.vx *= 1 - p.drag * dt; p.vy *= 1 - p.drag * dt;
      p.s.x += p.vx * dt; p.s.y += p.vy * dt; const k = p.life / p.max; p.s.alpha = Math.min(1, k * 2); if (p.shrink) p.s.scale.set(p.sx * Math.max(k, 0.2), p.sy * Math.max(k, 0.2));
    }
  }
  clear() { this.list.forEach((p) => p.s.destroy()); this.list = []; }
}

// ---------------- 界面小工具（像素风 HUD） ----------------
class Ui {
  constructor(private game: Game) {}
  /** 九宫格：贴图四角不拉伸，中间拉伸 */
  nineSlice(texture: string, o: { left?: number; top?: number; right?: number; bottom?: number; border?: number; width: number; height: number }) {
    const t = this.game.assets.textures[texture]; if (!t) throw new Error(`没有贴图「${texture}」`);
    const b = o.border ?? 4;
    return new PIXI.NineSliceSprite({ texture: t, leftWidth: o.left ?? b, topHeight: o.top ?? b, rightWidth: o.right ?? b, bottomHeight: o.bottom ?? b, width: o.width, height: o.height });
  }
  /** 文字：按当前缩放渲染，放大后仍然清楚 */
  text(s: string, style: Partial<PIXI.TextStyleOptions> = {}) {
    const t = new PIXI.Text({ text: s, style: { fontFamily: "monospace", fontSize: 8, fill: 0xffffff, ...style } as any });
    t.resolution = this.game.textResolution(); this.game.texts.add(t); t.on("destroyed", () => this.game.texts.delete(t));
    return t;
  }
  /** 条（血条、能量条）：返回容器和 set(0..1) */
  bar(o: { width: number; height: number; bg?: number; fg?: number; border?: number; value?: number }) {
    const c = new PIXI.Container(), g = new PIXI.Graphics(); c.addChild(g);
    const draw = (v: number) => {
      g.clear(); const b = o.border ?? 1;
      g.rect(0, 0, o.width, o.height).fill(0x000000);
      g.rect(b, b, o.width - 2 * b, o.height - 2 * b).fill(o.bg ?? 0x3a1f2b);
      g.rect(b, b, Math.round((o.width - 2 * b) * Math.max(0, Math.min(1, v))), o.height - 2 * b).fill(o.fg ?? 0xe0434b);
    };
    draw(o.value ?? 1);
    return Object.assign(c, { set: draw });
  }
}

// ---------------- 场景 ----------------
export interface SceneDef { enter?(g: Game, data?: any): void | Promise<void>; update?(g: Game, dt: number): void; render?(g: Game, alpha: number): void; exit?(g: Game): void }

// ---------------- AI 辅助（实时循环之外） ----------------
class AiHelper {
  constructor(private game: Game) {}
  private get api() { return W.oasis; }
  /** 等客户端空闲（AI 不在处理） */
  async idle(timeout = 30000) {
    const t0 = Date.now();
    while (this.api.busy && Date.now() - t0 < timeout) await new Promise((r) => setTimeout(r, 100));
  }
  /**
   * 请 AI 生成内容：发出组件事件（触发 ui:<组件id>.<event> 的 AI 接入点，接入点的 output.to 写到 state:<key>），
   * 等这个状态变了再返回新值。AI 关闭/失败/超时就返回 fallback。不阻塞游戏循环（await 即可）。
   */
  async ask<T = any>(event: string, payload: unknown, o: { key: string; timeout?: number; fallback?: T }): Promise<T> {
    await this.idle();
    const api = this.api, old = JSON.stringify(api.state[o.key]);
    return new Promise<T>((ok) => {
      let sawBusy = false, done = false;
      const finish = (v: any) => { if (done) return; done = true; off(); clearTimeout(timer); ok(v); };
      const off = api.onState((st: any) => {
        if (api.busy) { sawBusy = true; return; }
        const now = JSON.stringify(st[o.key]);
        if (now !== old) return finish(st[o.key]);
        if (sawBusy) finish(st[o.key] ?? o.fallback);
      });
      const timer = setTimeout(() => finish(api.state[o.key] !== undefined && JSON.stringify(api.state[o.key]) !== old ? api.state[o.key] : o.fallback), o.timeout ?? 25000);
      api.emit(event, payload);
    });
  }
  /** 调用故事动作（等客户端空闲再调；动作照常过引擎校验，可能触发 AI 接入点） */
  async action(id: string, params: Record<string, any> = {}) { await this.idle(); return this.api.action(id, params); }
  /** 等某个状态变化 */
  waitState<T = any>(key: string, timeout = 25000): Promise<T | undefined> {
    const api = this.api, old = JSON.stringify(api.state[key]);
    return new Promise((ok) => { const off = api.onState((st: any) => { if (JSON.stringify(st[key]) !== old) { off(); clearTimeout(t); ok(st[key]); } }); const t = setTimeout(() => { off(); ok(undefined); }, timeout); });
  }
}

// ---------------- 触屏虚拟按键（只在作者声明时出现） ----------------
function touchOverlay(cfg: TouchConfig | undefined, input: InputMap): (() => void) | undefined {
  if (!cfg || cfg.show === "never") return;
  const touchDevice = matchMedia?.("(pointer: coarse)").matches || "ontouchstart" in window;
  if (cfg.show !== "always" && !touchDevice) return;
  const root = document.createElement("div");
  root.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:10;touch-action:none;user-select:none;-webkit-user-select:none";
  const btn = (label: string, x: number, y: number, r: number, action: string) => {
    const b = document.createElement("div");
    const px = x < 0 ? `right:calc(${-x * 100}% - ${r}px)` : `left:calc(${x * 100}% - ${r}px)`, py = y < 0 ? `bottom:calc(${-y * 100}% - ${r}px)` : `top:calc(${y * 100}% - ${r}px)`;
    b.style.cssText = `position:absolute;${px};${py};width:${r * 2}px;height:${r * 2}px;border-radius:50%;background:rgba(20,16,30,.45);border:2px solid rgba(255,255,255,.55);color:#fff;font:bold ${Math.round(r * 0.7)}px monospace;display:flex;align-items:center;justify-content:center;pointer-events:auto;touch-action:none`;
    b.textContent = label;
    const down = (e: PointerEvent) => { e.preventDefault(); b.setPointerCapture?.(e.pointerId); b.style.background = "rgba(255,255,255,.35)"; input.virtualDown(action); };
    const up = (e: PointerEvent) => { e.preventDefault(); b.style.background = "rgba(20,16,30,.45)"; input.virtualUp(action); };
    b.addEventListener("pointerdown", down); b.addEventListener("pointerup", up); b.addEventListener("pointercancel", up); b.addEventListener("lostpointercapture", up);
    root.append(b);
  };
  for (const b of cfg.buttons ?? []) btn(b.label ?? b.action, b.x, b.y, b.r ?? 30, b.action);
  if (cfg.dpad) {
    const d = cfg.dpad, r = 24;
    btn("◀", 0.08, -0.16, r, d.left); btn("▶", 0.22, -0.16, r, d.right);
    if (d.up) btn("▲", 0.15, -0.3, r, d.up); if (d.down) btn("▼", 0.15, -0.05, r, d.down);
  }
  document.body.append(root);
  return () => root.remove();
}

// ---------------- 游戏 ----------------
export interface CreateOpts {
  /** 逻辑分辨率（像素风建议 320×180 / 384×216 / 480×270） */
  width?: number; height?: number;
  /** fit = 保持比例留黑边；expand = 高度固定，宽度跟着窗口变（不留黑边）；stretch = 拉满 */
  scaleMode?: "fit" | "expand" | "stretch";
  pixelArt?: boolean; background?: number | string; hz?: number;
  physics?: { gravity?: [number, number]; pixelsPerMeter?: number; layers?: string[]; debug?: boolean };
  input?: { actions?: Bindings; touch?: TouchConfig };
  assets?: Manifest; onProgress?: (p: number) => void;
}

export class Game {
  app!: PIXI.Application; root = new PIXI.Container(); world = new PIXI.Container(); hud = new PIXI.Container();
  width: number; height: number; scale = 1; pixelArt: boolean;
  loop: FixedLoop; input: InputMap; audio = new Audio(); assets: Assets; physics!: Physics; camera: Camera; particles: Particles; ui: Ui; ai: AiHelper;
  entities = new Set<Entity>(); texts = new Set<PIXI.Text>();
  scenes = new Map<string, SceneDef>(); current?: { name: string; def: SceneDef };
  time = 0; private last = 0; private offs: (() => void)[] = []; private evListeners = new Map<string, Set<(e: Entity, d: any) => void>>();
  private updaters = new Set<(dt: number) => void>(); private debugG?: PIXI.Graphics;
  readonly PIXI = PIXI; readonly RAPIER = RAPIER;
  constructor(private o: CreateOpts) {
    this.width = o.width ?? 384; this.height = o.height ?? 216; this.pixelArt = o.pixelArt ?? true;
    this.loop = new FixedLoop(o.hz ?? 60); this.input = new InputMap(o.input?.actions ?? DEFAULT_BINDINGS);
    this.assets = new Assets(this.audio); this.camera = new Camera(this); this.particles = new Particles(this); this.ui = new Ui(this); this.ai = new AiHelper(this);
  }
  async init() {
    await RAPIER.init();
    const p = this.o.physics ?? {};
    this.physics = new Physics(p.pixelsPerMeter ?? 32, { x: p.gravity?.[0] ?? 0, y: p.gravity?.[1] ?? 0 }, p.layers ?? []);
    if (this.pixelArt) PIXI.TextureStyle.defaultOptions.scaleMode = "nearest";
    this.app = new PIXI.Application();
    await this.app.init({ resizeTo: window, background: this.o.background ?? 0x000000, antialias: !this.pixelArt, preference: "webgl", autoDensity: true, resolution: Math.min(window.devicePixelRatio || 1, 2), roundPixels: this.pixelArt, autoStart: false, sharedTicker: false });
    document.body.style.cssText += ";margin:0;overflow:hidden;background:#000;touch-action:none";
    document.body.append(this.app.canvas);
    this.app.canvas.style.cssText = "display:block;width:100vw;height:100vh;image-rendering:" + (this.pixelArt ? "pixelated" : "auto");
    this.world.sortableChildren = true; this.hud.sortableChildren = true;
    this.world.addChild(this.particles.layer);
    this.root.addChild(this.world, this.hud); this.app.stage.addChild(this.root);
    if (p.debug) { this.debugG = new PIXI.Graphics(); this.debugG.zIndex = 99999; this.world.addChild(this.debugG); }
    const onResize = () => this.layout(); window.addEventListener("resize", onResize); this.offs.push(() => window.removeEventListener("resize", onResize));
    this.layout();
    // 输入：键盘/失焦；Esc 转给客户端（长按 1 秒打开暂停菜单）；第一次操作解锁声音
    this.offs.push(bindDom(this.input, window, { onEsc: (down) => parent.postMessage({ oasis: BRIDGE, type: "key", key: "Escape", down }, "*") }));
    const unlock = () => { this.audio.unlock(); window.focus(); };
    window.addEventListener("keydown", unlock); window.addEventListener("pointerdown", unlock);
    this.offs.push(() => { window.removeEventListener("keydown", unlock); window.removeEventListener("pointerdown", unlock); });
    // 手柄：优先用客户端转发的数据（沙箱里 Gamepad API 不一定可用）
    let forwarded = false;
    const onMsg = (e: MessageEvent) => { if (e.source !== parent) return; const m = e.data; if (m?.oasis === BRIDGE && m.type === "gamepad") { forwarded = true; this.input.setPad(m.buttons ?? [], m.axes ?? []); } };
    window.addEventListener("message", onMsg); this.offs.push(() => window.removeEventListener("message", onMsg));
    this.updaters.add(() => { if (!forwarded) { const p = readNativePad(); if (p) this.input.setPad(p.buttons, p.axes); } });
    const off = touchOverlay(this.o.input?.touch, this.input); if (off) this.offs.push(off);
    if (this.o.assets) await this.assets.load(this.o.assets, this.o.onProgress);
    window.focus();
  }
  /** 计算缩放：像素风取整数倍，保证像素方正 */
  layout() {
    const sw = window.innerWidth, sh = window.innerHeight, mode = this.o.scaleMode ?? "fit";
    let s = Math.min(sw / (this.o.width ?? 384), sh / (this.o.height ?? 216));
    if (mode === "expand") { s = sh / (this.o.height ?? 216); }
    if (this.pixelArt && s >= 1) s = Math.max(1, Math.floor(s + 0.01));
    if (mode === "expand") { this.height = Math.ceil(sh / s); this.width = Math.ceil(sw / s); }
    else if (mode === "stretch") { this.width = this.o.width ?? 384; this.height = this.o.height ?? 216; }
    this.scale = s;
    if (mode === "stretch") { this.root.scale.set(sw / this.width, sh / this.height); this.root.position.set(0, 0); }
    else { this.root.scale.set(s); this.root.position.set(Math.round((sw - this.width * s) / 2), Math.round((sh - this.height * s) / 2)); }
    const mask = this.root.mask as PIXI.Graphics | null; if (mask) mask.destroy();
    if (mode === "fit") { const m = new PIXI.Graphics().rect(this.root.x, this.root.y, this.width * s, this.height * s).fill(0xffffff); this.app.stage.addChild(m); this.root.mask = m; }
    else this.root.mask = null;
    for (const t of this.texts) t.resolution = this.textResolution();
    this.emitGame("resize", { width: this.width, height: this.height });
  }
  textResolution() { return Math.max(1, this.scale * Math.min(window.devicePixelRatio || 1, 2)); }

  // ---- 场景 ----
  scene(name: string, def: SceneDef) { this.scenes.set(name, def); return this; }
  async go(name: string, data?: any) {
    const def = this.scenes.get(name); if (!def) throw new Error(`没有场景「${name}」`);
    if (this.current) { this.current.def.exit?.(this); }
    for (const e of [...this.entities]) if (!e.has("persistent")) e.destroy();
    this.particles.clear(); this.camera.follow(undefined); this.camera.bounds = undefined;
    for (const c of [...this.hud.children]) c.destroy({ children: true });
    for (const c of [...this.world.children]) if (c !== this.particles.layer && c !== this.debugG) c.destroy({ children: true });
    this.current = { name, def };
    await def.enter?.(this, data);
  }

  // ---- 实体 ----
  spawn(o: SpawnOpts) {
    const e = new Entity(this, o); this.entities.add(e);
    (o.layer === "hud" ? this.hud : this.world).addChild(e.view);
    return e;
  }
  query(tag: string) { return [...this.entities].filter((e) => e.has(tag) && !e.dead); }
  /** 动画帧事件、自定义事件：on("hit_on", (entity, ev) => …) */
  on(name: string, cb: (e: Entity, d: any) => void) { let s = this.evListeners.get(name); if (!s) this.evListeners.set(name, (s = new Set())); s.add(cb); return () => s!.delete(cb); }
  emitEntityEvent(e: Entity, name: string, d: any) { this.evListeners.get(name)?.forEach((f) => f(e, d)); }
  private emitGame(name: string, d: any) { this.evListeners.get(`game:${name}`)?.forEach((f) => f(undefined as any, d)); }
  /** 每个固定步都会调用（场景之外的全局逻辑） */
  onUpdate(cb: (dt: number) => void) { this.updaters.add(cb); return () => this.updaters.delete(cb); }

  hitStop(ms: number) { this.loop.hitStop(ms); }
  get paused() { return this.loop.paused; } set paused(v: boolean) { this.loop.paused = v; if (v) this.input.releaseAll(); }

  /** 开始运行（可先 go 到某个场景） */
  start(scene?: string, data?: any) {
    const tick = (now: number) => {
      if (this.stopped) return;
      const ms = this.last ? now - this.last : 16.7; this.last = now;
      this.frame(ms); requestAnimationFrame(tick);
    };
    if (scene) void this.go(scene, data);
    requestAnimationFrame(tick);
    return this;
  }
  stopped = false;
  stop() { this.stopped = true; this.offs.forEach((f) => f()); this.audio.music(null); }
  private frame(ms: number) {
    const { steps, alpha } = this.loop.advance(ms), dt = this.loop.dt;
    for (let i = 0; i < steps; i++) this.step(dt);
    if (!this.loop.paused && steps === 0 && this.loop.frozenMs <= 0) this.input.step(); // 保持按键边沿正确
    this.camera.update(ms / 1000);
    const z = this.camera.zoom;
    this.world.scale.set(z);
    this.world.position.set(Math.round(this.width / 2 - this.camera.x * z + this.camera.ox), Math.round(this.height / 2 - this.camera.y * z + this.camera.oy));
    for (const e of this.entities) e.syncView();
    this.current?.def.render?.(this, alpha);
    if (this.debugG) this.drawDebug();
    this.app.render();
  }
  private step(dt: number) {
    this.time += dt;
    this.input.step();
    this.updaters.forEach((f) => f(dt));
    this.current?.def.update?.(this, dt);
    for (const e of [...this.entities]) { if (e.dead) continue; e.update?.(e, dt); if (e.dead) continue; e.fsm?.update(dt); if (e.flashT > 0) e.flashT -= dt; }
    this.physics.step();
    for (const e of this.entities) if (!e.cc) e.syncFromBody(); else { const p = e.body!.translation(), s = this.physics.scale; e.x = p.x * s; e.y = p.y * s; }
    this.particles.update(dt);
  }
  private drawDebug() {
    const g = this.debugG!, s = this.physics.scale; g.clear();
    this.physics.world.forEachCollider((c) => {
      const p = c.translation(), sh = c.shape as any, col = c.isSensor() ? 0x33ff66 : 0xff3366;
      if (!c.isEnabled()) return;
      if (sh.halfExtents) g.rect((p.x - sh.halfExtents.x) * s, (p.y - sh.halfExtents.y) * s, sh.halfExtents.x * 2 * s, sh.halfExtents.y * 2 * s).stroke({ width: 1, color: col });
      else if (sh.radius !== undefined) g.circle(p.x * s, p.y * s, sh.radius * s).stroke({ width: 1, color: col });
    });
  }
}

/** window.oasis.game */
const api = {
  version: RUNTIME_VERSION,
  async create(o: CreateOpts = {}) { await W.oasis?.ready; const g = new Game(o); await g.init(); return g; },
  PIXI, RAPIER, AnimFsm, InputMap, FixedLoop, checkFsm, compileCond, DEFAULT_BINDINGS,
  /** 读包内文件（组件 files 里列出的）：data: 地址 / 文本 / JSON */
  file: fileUrl, text: fileText, json: (p: string) => JSON.parse(fileText(p)),
};
if (W.oasis) W.oasis.game = api; else W.oasisGame = api;
export default api;
