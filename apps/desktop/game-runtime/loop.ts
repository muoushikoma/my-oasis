// 固定步长循环：逻辑和物理固定 1/hz 秒一步，与显示器刷新率无关；支持时间缩放和顿帧（hit-stop）。纯逻辑，可单测。
export class FixedLoop {
  readonly dt: number;
  acc = 0; timeScale = 1; paused = false; frozenMs = 0; steps = 0;
  constructor(hz = 60, readonly maxSteps = 5) { this.dt = 1 / hz; }
  /** 顿帧：接下来 ms 毫秒（真实时间）不推进逻辑，画面照常（镜头震动等） */
  hitStop(ms: number) { this.frozenMs = Math.max(this.frozenMs, ms); }
  /** 传入真实经过的毫秒数，返回本帧要跑几步；alpha 用于插值 */
  advance(realMs: number): { steps: number; alpha: number } {
    realMs = Math.min(Math.max(realMs, 0), 250);
    if (this.paused) return { steps: 0, alpha: 0 };
    if (this.frozenMs > 0) { const used = Math.min(this.frozenMs, realMs); this.frozenMs -= used; realMs -= used; }
    this.acc += (realMs / 1000) * this.timeScale;
    let n = 0;
    while (this.acc >= this.dt && n < this.maxSteps) { this.acc -= this.dt; n++; }
    if (n === this.maxSteps && this.acc > this.dt) this.acc = 0; // 卡顿太久：丢掉积压，不要“死亡螺旋”
    this.steps += n;
    return { steps: n, alpha: this.acc / this.dt };
  }
}
