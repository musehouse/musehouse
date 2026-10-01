// The "game loading" screen shown before entering the house.

type Step = "assets" | "connect" | "world";

const WEIGHTS: Record<Step, number> = { assets: 0.6, connect: 0.2, world: 0.2 };

export class LoadingScreen {
  private readonly root = document.getElementById("loading")!;
  private readonly fill = document.getElementById("loading-fill")!;
  private readonly bar = this.root.querySelector<HTMLElement>(".loading-bar")!;
  private readonly note = document.getElementById("loading-note")!;
  private readonly enter = document.getElementById("enter-btn") as HTMLButtonElement;
  private readonly progress: Record<Step, number> = { assets: 0, connect: 0, world: 0 };
  private entered = false;
  private onEnterCb: () => void = () => {};

  constructor() {
    this.setState("assets", "active");
    this.enter.addEventListener("click", () => this.hide());
    window.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !this.enter.disabled && !this.entered) this.hide();
    });
  }

  get isOpen() {
    return !this.entered;
  }

  onEnter(cb: () => void) {
    this.onEnterCb = cb;
  }

  /** value in 0..1 */
  set(step: Step, value: number, detail?: string) {
    this.progress[step] = Math.max(this.progress[step], Math.min(1, value));
    if (detail !== undefined) this.detail(step, detail);
    if (this.progress[step] < 1) this.setState(step, "active");
    this.render();
  }

  done(step: Step, detail?: string) {
    this.progress[step] = 1;
    if (detail !== undefined) this.detail(step, detail);
    this.setState(step, "done");
    this.render();
  }

  setNote(text: string) {
    this.note.textContent = text;
  }

  private detail(step: Step, text: string) {
    const el = document.getElementById(`${step}-detail`);
    if (el) el.textContent = text;
  }

  private setState(step: Step, state: "active" | "done") {
    const li = this.root.querySelector<HTMLElement>(`[data-step="${step}"]`);
    if (li && li.dataset.state !== "done") li.dataset.state = state;
  }

  private render() {
    const total = (Object.keys(WEIGHTS) as Step[]).reduce((sum, s) => sum + WEIGHTS[s] * this.progress[s], 0);
    const pct = Math.round(total * 100);
    this.fill.style.width = `${pct}%`;
    this.bar.setAttribute("aria-valuenow", String(pct));
    const ready = (Object.keys(WEIGHTS) as Step[]).every((s) => this.progress[s] >= 1);
    this.enter.disabled = !ready;
    this.enter.textContent = ready ? "Enter the house →" : `Loading… ${pct}%`;
    if (ready) {
      this.setNote("");
      if (!this.entered) this.enter.focus();
    }
  }

  hide() {
    if (this.entered) return;
    this.entered = true;
    this.root.classList.add("leaving");
    setTimeout(() => this.root.remove(), 600);
    this.onEnterCb();
  }
}
