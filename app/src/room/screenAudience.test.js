import { describe, expect, it } from 'vitest';
import { ScreenAudience, WATCH_ATTRIBUTE, WATCH_EXPIRY_MS, WATCH_HEARTBEAT_MS } from './screenAudience';
const screen = 'host:tela';
const upgraded = { attributes: { [WATCH_ATTRIBUTE]: 'assistindo' } };
describe('screen audience', () => {
    it('counts a viewer once and removes them on stop or leave', () => {
        const audience = new ScreenAudience();
        expect(audience.canPause(screen, [upgraded])).toBe(true);
        audience.announce('alice', screen, true, 0);
        audience.announce('alice', screen, true, 1);
        audience.announce('bob', screen, true, 1);
        expect(audience.count(screen)).toBe(2);
        expect(audience.canPause(screen, [upgraded])).toBe(false);
        audience.announce('alice', screen, false, 2);
        audience.leave('bob');
        expect(audience.canPause(screen, [upgraded])).toBe(true);
    });
    it('expires exactly 45 seconds after the last heartbeat', () => {
        const audience = new ScreenAudience();
        audience.announce('viewer', screen, true, 0);
        audience.announce('viewer', screen, true, WATCH_HEARTBEAT_MS);
        audience.expire(WATCH_HEARTBEAT_MS + WATCH_EXPIRY_MS - 1);
        expect(audience.count(screen)).toBe(1);
        audience.expire(WATCH_HEARTBEAT_MS + WATCH_EXPIRY_MS);
        expect(audience.count(screen)).toBe(0);
    });
    it('keeps video running when a legacy viewer could be watching', () => {
        const audience = new ScreenAudience();
        expect(audience.canPause(screen, [upgraded, { attributes: {} }])).toBe(false);
        expect(audience.canPause(screen, [upgraded])).toBe(true);
    });
    it('keeps the new screen when a viewer switches and the old screen stops', () => {
        const audience = new ScreenAudience();
        audience.announce('viewer', screen, true, 0);
        audience.announce('viewer', 'other:tela', true, 1);
        audience.announce('viewer', screen, false, 2);
        expect(audience.count(screen)).toBe(0);
        expect(audience.count('other:tela')).toBe(1);
    });
});
