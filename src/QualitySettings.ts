import { Event } from './kernel/Event.js';
import { gameStarted, liveGames, type Game } from './play.js';
import { port } from './port.js';

/**
 * Which shadows are drawn — Unity's `ShadowQuality`: none, hard-edged ones only (the cheapest the
 * renderer has), or all, as the game set its renderer up.
 */
export const ShadowQuality = { Disable: 0, HardOnly: 1, All: 2 } as const;
export type ShadowQuality = (typeof ShadowQuality)[keyof typeof ShadowQuality];

/** One quality level, as in Unity's Quality settings. */
export interface QualityLevel {
  name: string;
  shadows: ShadowQuality;
  /** The resolution drawn, times the screen's — URP's `renderScale`: below 1 is fewer pixels to fill. */
  renderScale: number;
  /** Whether a post-processing `Volume` draws its effects. */
  postProcessing: boolean;
}

let current = 2;
/** Whether a level was ever set: until then, games run as they were set up. Nothing runs at import, so a game that never sets one ships none of this. */
let chosen = false;
/** A game started after the level was set takes it once `main.ts` has set its renderer up. */
const started = (game: Game) => queueMicrotask(() => liveGames.has(game) && apply(game));

/**
 * Unity's `QualitySettings`: named levels, one of them active, for every running game. The game picks
 * the level — from a menu, or from what it knows of the device — and nothing changes until it does.
 * Set the renderer up first, as three.js documents, then the level: `renderer.shadowMap.enabled = true`,
 * then `QualitySettings.setQualityLevel(0)` on a phone.
 */
export const QualitySettings = {
  /** The levels, lowest first. Change them before setting one. */
  // ShadowQuality's values written out: reading its properties here would keep this module in every game.
  levels: [
    { name: 'Low', shadows: 0, renderScale: 0.75, postProcessing: false },
    { name: 'Medium', shadows: 1, renderScale: 1, postProcessing: true },
    { name: 'High', shadows: 2, renderScale: 1, postProcessing: true },
  ] as QualityLevel[],
  /** After the level changed: the one before, and the one now. */
  activeQualityLevelChanged: /* @__PURE__ */ new Event<[previous: number, current: number]>(),

  get names(): string[] {
    return this.levels.map((l) => l.name);
  },
  getQualityLevel(): number {
    return current;
  },
  /** Make `index` the active level, and apply it to every running game at once. */
  setQualityLevel(index: number): void {
    if (!Number.isInteger(index) || !this.levels[index]) {
      throw new Error(`QualitySettings.setQualityLevel: ${index} is not a level. There are ${this.levels.length}: ${this.names.map((n, i) => `${i} ${n}`).join(', ')}.`);
    }
    const previous = current;
    current = index;
    if (!chosen) gameStarted.on(started);
    chosen = true;
    for (const game of liveGames) apply(game);
    if (previous !== index) this.activeQualityLevelChanged.emit(previous, index);
  },
  /** The active level's. */
  get shadows(): ShadowQuality {
    return this.levels[current]!.shadows;
  },
  get renderScale(): number {
    return this.levels[current]!.renderScale;
  },
  get postProcessing(): boolean {
    return this.levels[current]!.postProcessing;
  },
};

/** The active level, applied by the renderer: scaled and turned off from how the game set it up. */
function apply(game: Game): void {
  port().applyQuality?.(game.renderer, game.scene, QualitySettings.levels[current]!);
}
