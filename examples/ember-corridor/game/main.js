// 余烬回廊 / Ember Corridor —— 横版动作演示（oasis 内置游戏运行时）
// 实时部分（移动、跳跃、攻击、碰撞）全在本地跑；AI 只在波次之间写旁白，不进实时循环。
(async () => {
  const O = window.oasis, R = O.game;
  await O.ready;
  const en = String(O.lang || "").startsWith("en");
  const T = (zh, enText) => (en ? enText : zh);
  const LEVEL_W = 768, FLOOR = 184, MAX_HP = 5, WAVES = 3;

  const game = await R.create({
    height: 216, scaleMode: "expand", pixelArt: true, background: 0x1a1024,
    physics: { pixelsPerMeter: 16, layers: ["world", "player", "enemy"] },
    input: {
      actions: { ...R.DEFAULT_BINDINGS },
      // 触屏按键：只在触屏设备上出现；桌面不显示
      touch: { dpad: { left: "left", right: "right" }, buttons: [{ action: "jump", label: "A", x: -0.09, y: -0.16, r: 30 }, { action: "attack", label: "B", x: -0.24, y: -0.22, r: 30 }] },
    },
    assets: {
      images: { backdrop: "game/art/backdrop.png", panel: "game/art/panel.png" },
      sheets: R.json("game/data/sheets.json"),
      json: { heroFsm: "game/data/hero.fsm.json", slimeFsm: "game/data/slime.fsm.json" },
      sounds: { jump: "game/sfx/jump.wav", slash: "game/sfx/slash.wav", hit: "game/sfx/hit.wav", hurt: "game/sfx/hurt.wav", pop: "game/sfx/pop.wav", clear: "game/sfx/clear.wav", music: "game/sfx/music.wav" },
    },
  });
  const { PIXI } = R, P = game.physics, inp = game.input, sfx = (id, o) => game.audio.play(id, o);
  const rand = (a, b) => a + Math.random() * (b - a);
  const confirmPressed = () => inp.pressed("confirm") || inp.pressed("jump") || inp.pressed("attack");

  // ---------- AI 文本：等动作跑完（含 AI 接入点），再取旁白；拿不到就用本地备用句 ----------
  const FALLBACK = {
    clear_wave: T("火光暂时稳住了。更深处传来湿漉漉的蠕动声。", "The flames steady for now. Something wet stirs deeper in."),
    fall: T("你倒在余烬里——但火种还在。再站起来。", "You fall among the embers — but the spark remains. Rise again."),
    finish: T("最后一盏火把亮起，回廊重归寂静。", "The last torch flares and the corridor falls silent."),
  };
  async function narrate(action) {
    const old = O.state.narration;
    try { await game.ai.action(action); } catch (e) { console.warn(e); }
    const v = O.state.narration !== old ? O.state.narration : await game.ai.waitState("narration", 1500);
    return (typeof v === "string" && v.trim()) ? v : FALLBACK[action] || "";
  }

  // ---------- 场景搭建 ----------
  function buildLevel() {
    const bd = new PIXI.TilingSprite({ texture: game.assets.textures.backdrop, width: game.width + 32, height: 216 });
    bd.zIndex = -100; game.world.addChild(bd);
    const tiles = game.assets.sheets.tiles.frames, layer = new PIXI.Container(); layer.zIndex = -10; game.world.addChild(layer);
    const put = (f, x, y) => { const s = new PIXI.Sprite(tiles[f]); s.position.set(x, y); layer.addChild(s); };
    for (let x = 0; x < LEVEL_W; x += 16) { put(0, x, FLOOR); put(1, x, FLOOR + 16); put(1, x, FLOOR + 32); }
    P.static(LEVEL_W / 2, FLOOR + 24, { box: [LEVEL_W, 48], layer: "world" });
    P.static(-8, 0, { box: [16, 600], layer: "world" }); P.static(LEVEL_W + 8, 0, { box: [16, 600], layer: "world" });
    for (const [px, py, w] of [[176, 140, 64], [384, 108, 48], [560, 140, 64]]) {
      for (let x = 0; x < w; x += 16) put(2, px - w / 2 + x, py);
      P.static(px, py + 4, { box: [w, 8], layer: "world" });
    }
    for (const tx of [96, 288, 480, 672]) {
      game.spawn({ x: tx, y: 120, anim: { sheet: "torch", clip: "burn" }, z: -5, tags: ["torch"] });
    }
    return bd;
  }

  // ---------- 主角 ----------
  function spawnHero(run) {
    const h = game.spawn({
      x: 80, y: FLOOR - 12, tags: ["hero"], z: 10, anchor: [0.41, 0.56],
      anim: { sheet: "hero", fsm: "heroFsm" },
      body: { box: [10, 20], layer: "player", mask: ["world", "enemy"] },
      character: { offset: 0.5, snapToGround: 3, mask: ["world"] },
      data: { hp: MAX_HP, inv: 0, coyote: 0, buf: 0, cd: 0, kb: 0, touching: new Set(), hitSet: new Set() },
      onHit: (other, started) => { if (other.entity?.has("enemy")) started ? h.data.touching.add(other.entity) : h.data.touching.delete(other.entity); },
      update: (e, dt) => {
        const d = e.data, f = e.fsm, alive = d.hp > 0 && run.phase !== "victory";
        const ctl = alive && run.phase === "fight";
        let dir = ctl ? inp.axis("left", "right") : 0;
        const attacking = f.state === "attack";
        if (d.kb > 0) { d.kb -= dt; } else e.vx = dir * (attacking && e.grounded ? 40 : 92);
        if (dir && !attacking && d.kb <= 0) e.facing = dir;
        // 土狼时间 + 跳跃缓冲 + 可变跳高
        d.coyote = e.grounded ? 0.1 : d.coyote - dt;
        d.buf = ctl && inp.pressed("jump") ? 0.12 : d.buf - dt;
        if (d.buf > 0 && d.coyote > 0) {
          e.vy = -262; d.buf = 0; d.coyote = 0; sfx("jump", { volume: 0.5 });
          game.particles.burst({ x: e.x, y: e.y + 10, count: 6, color: [0x9c8a7a, 0x6b5d52], speed: [20, 50], angle: [180, 360], life: 0.3, gravity: 80 });
        }
        if (ctl && inp.released("jump") && e.vy < 0) e.vy *= 0.45;
        e.vy = Math.min(e.vy + 820 * dt, 420);
        const was = e.grounded;
        e.grounded = e.move(e.vx * dt, e.vy * dt);
        if (e.grounded && e.vy > 0) { if (!was && e.vy > 200) game.particles.burst({ x: e.x, y: e.y + 10, count: 5, color: 0x8a7a6a, speed: [15, 40], angle: [200, 340], life: 0.25 }); e.vy = 0; }
        if (!e.grounded && e.vy < 0 && headBonk(e)) e.vy = 30;
        d.cd -= dt;
        if (ctl && inp.pressed("attack") && d.cd <= 0) { f.trigger("attack"); d.cd = 0.32; d.hitSet.clear(); }
        f.set("speed", Math.abs(e.vx)); f.set("grounded", e.grounded); f.set("vy", e.vy);
        // 接触伤害（传感器碰撞事件）
        d.inv -= dt;
        if (alive && d.inv <= 0) for (const en2 of d.touching) { if (!en2.dead && en2.data.hp > 0) { hurtHero(e, en2, run); break; } }
      },
    });
    return h;
  }
  // 撞到头顶：短射线
  function headBonk(e) { const hit = P.raycast(e.x, e.y - 10, 0, -1, 2, { exclude: e, mask: ["world"] }); return !!hit; }

  function hurtHero(h, src, run) {
    const d = h.data; d.hp--; d.inv = 1.1; d.kb = 0.18;
    const away = Math.sign(h.x - src.x) || -h.facing; h.vx = away * 140; h.vy = -150;
    h.flash(1100); game.hitStop(90); game.camera.shake(5, 260); sfx("hurt");
    game.particles.burst({ x: h.x, y: h.y, count: 10, color: [0xff5a5a, 0xffd0a0], speed: [40, 110], life: [0.2, 0.5], gravity: 300 });
    if (d.hp <= 0) { h.fsm.set("dead", true); run.phase = "down"; void onDown(run); }
    else h.fsm.trigger("hurt");
  }

  // ---------- 敌人 ----------
  function spawnSlime(x, big) {
    const s = big ? 2 : 1;
    const e = game.spawn({
      x, y: 40, tags: ["enemy", "slime"], z: 5, anchor: [0.5, 0.75],
      anim: { sheet: "slime", fsm: "slimeFsm" },
      body: { box: [12 * s, 9 * s], layer: "enemy", mask: ["player"], sensor: true },
      character: { offset: 0.5, snapToGround: 2, mask: ["world"] },
      data: { hp: big ? 7 : 2, hop: rand(0.4, 1.2), big, kb: 0 },
      update: (m, dt) => {
        const d = m.data, hero = game.query("hero")[0];
        if (d.hp <= 0) { m.vx *= 0.9; }
        else if (m.grounded) {
          m.vx = 0; d.hop -= dt;
          if (d.hop <= 0 && hero) { const dir = Math.sign(hero.x - m.x) || 1; m.facing = -dir; m.vx = dir * (big ? 55 : 70) * rand(0.8, 1.2); m.vy = big ? -230 : rand(-200, -150); d.hop = big ? rand(0.9, 1.4) : rand(0.6, 1.3); }
        }
        if (d.kb > 0) d.kb -= dt;
        m.vy = Math.min(m.vy + 700 * dt, 400);
        m.grounded = m.move(m.vx * dt, m.vy * dt);
        if (m.grounded && m.vy > 0) m.vy = 0;
        m.fsm.set("grounded", m.grounded);
      },
    });
    if (big) e.sprite.scale.set(2);
    return e;
  }
  function spawnBat(x) {
    return game.spawn({
      x, y: rand(50, 80), tags: ["enemy", "bat"], z: 6,
      anim: { sheet: "bat", clip: "fly" },
      body: { type: "kinematic", box: [10, 8], layer: "enemy", mask: ["player"], sensor: true },
      data: { hp: 1, t: rand(0, 6), mode: "patrol", home: rand(55, 85), dir: Math.random() < 0.5 ? -1 : 1, cd: rand(1, 2.5), dx: 0, dy: 0, dt: 0 },
      update: (b, dt) => {
        const d = b.data, hero = game.query("hero")[0]; d.t += dt;
        let vx = 0, vy = 0;
        if (d.hp <= 0) { vy = 160; }
        else if (d.mode === "patrol") {
          vx = d.dir * 42; vy = Math.cos(d.t * 3) * 30 + (d.home - b.y) * 1.5;
          if (b.x < 24) d.dir = 1; if (b.x > LEVEL_W - 24) d.dir = -1;
          d.cd -= dt;
          if (hero && d.cd <= 0 && Math.abs(hero.x - b.x) < 130) { d.mode = "dive"; const dx = hero.x - b.x, dy = hero.y - b.y, l = Math.hypot(dx, dy) || 1; d.dx = dx / l; d.dy = dy / l; d.dt = 0; }
        } else if (d.mode === "dive") {
          d.dt += dt; vx = d.dx * 150; vy = d.dy * 150;
          if (d.dt > 1 || b.y > FLOOR - 8) { d.mode = "rise"; }
        } else { vx = d.dir * 30; vy = -70; if (b.y <= d.home) { d.mode = "patrol"; d.cd = rand(1.5, 3); } }
        b.facing = vx < 0 ? -1 : 1;
        b.move(vx * dt, vy * dt);
      },
    });
  }

  function damageEnemy(m, dir, run) {
    const d = m.data; if (d.hp <= 0) return;
    d.hp--; m.flash(120); sfx("hit", { rate: rand(0.9, 1.1) });
    game.hitStop(d.hp <= 0 ? 80 : 55); game.camera.shake(d.hp <= 0 ? 3 : 2, 140);
    game.particles.burst({ x: m.x, y: m.y, count: d.hp <= 0 ? 16 : 8, color: m.has("bat") ? [0xb48cff, 0x5b3d8a] : [0x8de06a, 0x3d8a3a, 0xffffff], speed: [40, 130], life: [0.2, 0.55], gravity: 260, size: [1, 3] });
    if (m.has("slime")) { m.vx = dir * (d.big ? 60 : 130); m.vy = d.big ? -60 : -140; m.grounded = false; m.fsm.trigger("hurt"); }
    if (d.hp <= 0) {
      try { m.fsm.set("dead", true); } catch { /* 蝙蝠没有 dead 参数 */ }
      for (const c of m.colliders) c.setEnabled(false);
      run.kills++;
      setTimeout(() => { if (!m.dead) { sfx("pop", { volume: 0.6 }); game.particles.burst({ x: m.x, y: m.y, count: 10, color: 0xffe9a8, speed: [20, 70], life: 0.4 }); m.destroy(); } }, m.has("bat") ? 450 : 380);
    }
  }

  // ---------- HUD ----------
  function buildHud() {
    const hud = {};
    const panel = game.ui.nineSlice("panel", { width: 4 + MAX_HP * 10 + 4, height: 16, border: 4 });
    panel.position.set(6, 6); game.hud.addChild(panel); hud.panel = panel;
    hud.hearts = [];
    for (let i = 0; i < MAX_HP; i++) { const s = new PIXI.Sprite(game.assets.sheets.hearts.frames[0]); s.position.set(10 + i * 10, 10); game.hud.addChild(s); hud.hearts.push(s); }
    hud.wave = game.ui.text("", { fontSize: 8, fill: 0xffe0a0, stroke: { color: 0x1a1024, width: 2 } }); hud.wave.anchor.set(1, 0); game.hud.addChild(hud.wave);
    hud.flavor = game.ui.text("", { fontSize: 8, fill: 0xd8c8ff, stroke: { color: 0x1a1024, width: 2 }, wordWrap: true, wordWrapWidth: 240, align: "center" }); hud.flavor.anchor.set(0.5, 0); game.hud.addChild(hud.flavor);
    hud.flavorT = 0;
    hud.banner = game.ui.text("", { fontSize: 16, fill: 0xffd27a, stroke: { color: 0x2a1020, width: 3 }, fontWeight: "bold" }); hud.banner.anchor.set(0.5); game.hud.addChild(hud.banner);
    hud.bannerT = 0;
    // 对话框（九宫格 + 打字机）
    hud.box = new PIXI.Container(); game.hud.addChild(hud.box);
    hud.boxBg = game.ui.nineSlice("panel", { width: 200, height: 56, border: 4 }); hud.box.addChild(hud.boxBg);
    hud.boxText = game.ui.text("", { fontSize: 9, fill: 0xf4ead8, wordWrap: true, wordWrapWidth: 180, lineHeight: 12, breakWords: true }); hud.boxText.position.set(8, 6); hud.box.addChild(hud.boxText);
    hud.prompt = game.ui.text("▼", { fontSize: 8, fill: 0xffd27a }); hud.box.addChild(hud.prompt);
    hud.box.visible = false; hud.full = ""; hud.shown = 0;
    return hud;
  }
  function say(hud, text) { hud.full = text || "…"; hud.shown = 0; hud.box.visible = true; hud.boxText.text = ""; }
  function hudLayout(hud) {
    const W = game.width, bw = Math.min(W - 24, 300);
    hud.wave.position.set(W - 8, 8);
    hud.flavor.position.set(W / 2, 26); hud.flavor.style.wordWrapWidth = Math.min(W - 40, 260);
    hud.banner.position.set(W / 2, 84);
    hud.boxBg.width = bw; hud.boxBg.height = 58; hud.boxText.style.wordWrapWidth = bw - 16;
    hud.box.position.set(Math.round((W - bw) / 2), 216 - 58 - 8);
    hud.prompt.position.set(bw - 12, 44);
  }

  // ---------- 波次 ----------
  const WAVE_DEF = {
    1: [["slime", 3]],
    2: [["slime", 3], ["bat", 2]],
    3: [["slime", 4], ["bat", 4], ["big", 1]],
  };
  function startWave(run, n) {
    run.wave = n; run.queue = [];
    for (const [k, c] of WAVE_DEF[n]) for (let i = 0; i < c; i++) run.queue.push(k);
    run.queue.sort(() => Math.random() - 0.5);
    if (run.queue.includes("big")) { run.queue = run.queue.filter((k) => k !== "big"); run.queue.push("big"); }
    run.spawnT = 1.6; run.phase = "fight";
    run.hud.banner.text = T(`第 ${n} 波`, `WAVE ${n}`); run.hud.bannerT = 1.6;
    const names = WAVE_DEF[n].map(([k, c]) => `${c}× ${k === "big" ? T("巨型史莱姆", "giant slime") : k === "bat" ? T("蝙蝠", "bat") : T("史莱姆", "slime")}`).join(", ");
    // 异步问 AI 侦察一句话；拿到后显示在顶部，游戏不用等
    void game.ai.ask("scout", { wave: n, enemies: names }, { key: "flavor", timeout: 20000, fallback: "" }).then((v) => {
      if (run.wave === n && typeof v === "string" && v) { run.hud.flavor.text = v; run.hud.flavorT = 6; }
    });
  }
  async function onWaveClear(run) {
    run.phase = "talk"; sfx("clear"); run.hud.banner.text = T("清场！", "CLEAR!"); run.hud.bannerT = 1.4;
    say(run.hud, "…");
    const text = await narrate("clear_wave");
    say(run.hud, text);
    run.next = Number(O.state.wave) >= WAVES + 1 || run.wave >= WAVES ? "victory" : "wave";
  }
  async function onDown(run) {
    await new Promise((r) => setTimeout(r, 1100));
    say(run.hud, "…");
    const text = await narrate("fall");
    say(run.hud, text);
    run.next = "retry";
  }

  // ---------- 场景：标题 ----------
  game.scene("title", {
    enter() {
      const bd = buildLevel(); this.bd = bd;
      this.hud = buildHud(); hudLayout(this.hud);
      this.title = game.ui.text(T("余烬回廊", "EMBER CORRIDOR"), { fontSize: 24, fill: 0xffb347, stroke: { color: 0x2a1020, width: 4 }, fontWeight: "bold" });
      this.title.anchor.set(0.5); game.hud.addChild(this.title);
      this.sub = game.ui.text(T("←→ 移动　空格/K 跳　J/X 攻击", "←→ move · Space/K jump · J/X attack"), { fontSize: 8, fill: 0xd8c8ff });
      this.sub.anchor.set(0.5); game.hud.addChild(this.sub);
      game.camera.setBounds(0, 0, LEVEL_W, 216); game.camera.x = LEVEL_W / 2; game.camera.y = 108;
      this.t = 0; this.ready = false;
      // 开场旁白由 game_start 的 AI 接入点写入 state.narration（可能还在生成）
      say(this.hud, O.state.narration || T("（火把噼啪作响……）", "(The torches crackle...)"));
    },
    update(g, dt) {
      this.t += dt; const hud = this.hud;
      if (O.state.narration && hud.full !== O.state.narration && !this.ready) say(hud, O.state.narration);
      this.ready = !O.busy && this.t > 0.6;
      if (this.ready && hud.shown >= hud.full.length && confirmPressed()) g.go("arena", { wave: Math.max(1, Math.min(WAVES, Number(O.state.wave) || 1)) });
      else if (confirmPressed()) hud.shown = hud.full.length;
    },
    render() {
      const W = game.width; this.title.position.set(W / 2, 54 + Math.sin(this.t * 2) * 2); this.sub.position.set(W / 2, 80);
      hudLayout(this.hud); commonRender(this.hud, this.bd, this.ready);
      this.hud.hearts.forEach((h) => (h.visible = false)); this.hud.panel.visible = false;
    },
  });

  // ---------- 场景：战斗 ----------
  game.scene("arena", {
    enter(g, data) {
      this.bd = buildLevel();
      const run = (this.run = { phase: "fight", kills: 0, wave: 1, queue: [], spawnT: 0, next: null });
      run.hud = buildHud(); hudLayout(run.hud);
      run.hero = spawnHero(run);
      g.camera.follow(run.hero, { lerp: 0.12, deadzone: [40, 32] }); g.camera.setBounds(0, 0, LEVEL_W, 216);
      this.offHit = g.on("hit_on", (e) => { if (e === run.hero) this.swing = true; });
      this.offOff = g.on("hit_off", (e) => { if (e === run.hero) this.swing = false; });
      this.offSwing = g.on("swing", (e) => { if (e === run.hero) sfx("slash", { volume: 0.6, rate: rand(0.95, 1.08) }); });
      this.swing = false;
      startWave(run, data?.wave ?? 1);
    },
    exit() { this.offHit?.(); this.offOff?.(); this.offSwing?.(); },
    update(g, dt) {
      const run = this.run, hud = run.hud, hero = run.hero;
      if (!game.audio.musicNode && game.audio.buffers.music) game.audio.music("music", { volume: 0.35 });
      // 攻击判定：攻击帧打开期间每帧查一次（overlapBox）
      if (this.swing && !hero.dead) {
        const cx = hero.x + hero.facing * 15, cy = hero.y - 2;
        for (const m of P.overlapBox(cx, cy, 24, 20, { mask: ["enemy"] })) {
          if (m.has("enemy") && !hero.data.hitSet.has(m)) { hero.data.hitSet.add(m); damageEnemy(m, hero.facing, run); }
        }
      }
      if (run.phase === "fight") {
        run.spawnT -= dt;
        if (run.queue.length && run.spawnT <= 0) {
          const k = run.queue.shift(), side = Math.random() < 0.5 ? -1 : 1;
          const x = Math.max(24, Math.min(LEVEL_W - 24, hero.x + side * rand(110, 170)));
          k === "bat" ? spawnBat(x) : spawnSlime(x, k === "big");
          game.particles.burst({ x, y: 40, count: 12, color: [0xff8a3d, 0xffd27a], speed: [20, 60], life: 0.5 });
          run.spawnT = k === "big" ? 0 : rand(0.7, 1.3);
        }
        if (!run.queue.length && game.query("enemy").length === 0) void onWaveClear(run);
      }
      if (run.phase === "talk" || run.phase === "down") {
        if (confirmPressed()) {
          if (hud.shown < hud.full.length) hud.shown = hud.full.length;
          else if (run.next && !O.busy) {
            const nx = run.next; run.next = null; hud.box.visible = false;
            if (nx === "wave") startWave(run, run.wave + 1);
            else if (nx === "retry") g.go("arena", { wave: 1 });
            else { run.phase = "victory"; hud.banner.text = T("回廊守住了！", "THE CORRIDOR HOLDS!"); hud.bannerT = 999; say(hud, "…"); void narrate("finish").then((t) => say(hud, t)); }
          }
        }
      }
      if (hud.flavorT > 0) hud.flavorT -= dt;
      if (hud.bannerT > 0) hud.bannerT -= dt;
    },
    render() {
      const run = this.run, hud = run.hud; hudLayout(hud);
      hud.hearts.forEach((s, i) => (s.texture = game.assets.sheets.hearts.frames[i < run.hero.data.hp ? 0 : 2]));
      hud.wave.text = T(`第 ${run.wave}/${WAVES} 波`, `WAVE ${run.wave}/${WAVES}`);
      commonRender(hud, this.bd, !!run.next && !O.busy);
    },
  });

  function commonRender(hud, bd, canGo) {
    const cam = game.camera, left = cam.x - game.width / 2;
    bd.x = left - 16; bd.width = game.width + 32; bd.tilePosition.x = -left * 0.35;
    hud.flavor.alpha = Math.max(0, Math.min(1, hud.flavorT)); hud.banner.visible = hud.bannerT > 0;
    if (hud.box.visible) {
      if (hud.shown < hud.full.length) { hud.shown = Math.min(hud.full.length, hud.shown + 0.6); hud.boxText.text = hud.full.slice(0, Math.floor(hud.shown)); }
      else hud.boxText.text = hud.full;
      hud.prompt.visible = canGo && hud.shown >= hud.full.length && Math.floor(performance.now() / 400) % 2 === 0;
    }
  }

  game.start("title");
})();
