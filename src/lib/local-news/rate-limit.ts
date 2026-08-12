export type LocalNewsSleep = (milliseconds: number) => Promise<void>;

export class LocalNewsRequestLimiter {
  readonly #minimumIntervalMs: number;
  readonly #sleep: LocalNewsSleep;
  #nextRequestAt = 0;

  constructor(input: { minimumIntervalMs: number; sleep?: LocalNewsSleep }) {
    this.#minimumIntervalMs = Math.max(0, Math.floor(input.minimumIntervalMs));
    this.#sleep = input.sleep || sleep;
  }

  async acquire(): Promise<void> {
    const delay = Math.max(0, this.#nextRequestAt - Date.now());
    if (delay > 0) await this.#sleep(delay);
    this.#nextRequestAt = Date.now() + this.#minimumIntervalMs;
  }

  defer(milliseconds: number): void {
    const delay = Math.max(0, Math.floor(milliseconds));
    this.#nextRequestAt = Math.max(this.#nextRequestAt, Date.now() + delay);
  }
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
