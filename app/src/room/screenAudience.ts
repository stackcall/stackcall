export const WATCH_TOPIC = 'stackcall.assistindo';
export const WATCH_ATTRIBUTE = 'stackcall.recursos';
export const WATCH_RESOURCE = 'assistindo';
export const WATCH_HEARTBEAT_MS = 20_000;
export const WATCH_EXPIRY_MS = 45_000;
export const WATCH_GRACE_MS = 5_000;

export const supportsWatching = (attributes: Readonly<Record<string, string>>) =>
  attributes[WATCH_ATTRIBUTE]?.split(',').includes(WATCH_RESOURCE) ?? false;

export class ScreenAudience {
  private viewers = new Map<string, { screen: string; until: number }>();

  announce(viewer: string, screen: string, watching: boolean, now: number): boolean {
    const old = this.viewers.get(viewer);
    if (!watching) return old?.screen === screen && this.leave(viewer);
    this.viewers.set(viewer, { screen, until: now + WATCH_EXPIRY_MS });
    return old?.screen !== screen;
  }

  leave(viewer: string): boolean {
    return this.viewers.delete(viewer);
  }

  has(viewer: string): boolean {
    return this.viewers.has(viewer);
  }

  /** `viewer` currently watches `screen`. */
  watching(viewer: string, screen: string): boolean {
    return this.viewers.get(viewer)?.screen === screen;
  }

  expire(now: number): boolean {
    let changed = false;
    for (const [viewer, { until }] of this.viewers) {
      if (until <= now) changed = this.leave(viewer) || changed;
    }
    return changed;
  }

  nextExpiry(): number {
    let next = Infinity;
    for (const { until } of this.viewers.values()) next = Math.min(next, until);
    return next;
  }

  count(screen: string): number {
    return [...this.viewers.values()].filter((viewer) => viewer.screen === screen).length;
  }

  canPause(screen: string, viewers: Iterable<{ attributes: Readonly<Record<string, string>> }>): boolean {
    return this.count(screen) === 0 && [...viewers].every((viewer) => supportsWatching(viewer.attributes));
  }
}
