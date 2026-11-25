export const WATCH_TOPIC = 'stackcall.assistindo';
export const WATCH_ATTRIBUTE = 'stackcall.recursos';
export const WATCH_RESOURCE = 'assistindo';
export const WATCH_HEARTBEAT_MS = 20_000;
export const WATCH_EXPIRY_MS = 45_000;
export const WATCH_GRACE_MS = 5_000;
export const supportsWatching = (attributes) => attributes[WATCH_ATTRIBUTE]?.split(',').includes(WATCH_RESOURCE) ?? false;
export class ScreenAudience {
    viewers = new Map();
    announce(viewer, screen, watching, now) {
        const old = this.viewers.get(viewer);
        if (!watching)
            return old?.screen === screen && this.leave(viewer);
        this.viewers.set(viewer, { screen, until: now + WATCH_EXPIRY_MS });
        return old?.screen !== screen;
    }
    leave(viewer) {
        return this.viewers.delete(viewer);
    }
    has(viewer) {
        return this.viewers.has(viewer);
    }
    /** `viewer` currently watches `screen`. */
    watching(viewer, screen) {
        return this.viewers.get(viewer)?.screen === screen;
    }
    expire(now) {
        let changed = false;
        for (const [viewer, { until }] of this.viewers) {
            if (until <= now)
                changed = this.leave(viewer) || changed;
        }
        return changed;
    }
    nextExpiry() {
        let next = Infinity;
        for (const { until } of this.viewers.values())
            next = Math.min(next, until);
        return next;
    }
    count(screen) {
        return [...this.viewers.values()].filter((viewer) => viewer.screen === screen).length;
    }
    canPause(screen, viewers) {
        return this.count(screen) === 0 && [...viewers].every((viewer) => supportsWatching(viewer.attributes));
    }
}
