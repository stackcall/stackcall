import { useEffect, useState } from 'react';
import { demoScreen, isDemo, store, type RoomId } from './lib/config';
import { useUpdater } from './lib/updater';
import type { Session } from './room/useLiveRoom';
import { DemoRoom, LiveRoom } from './screens/Room';
import { Login } from './screens/Login';
import { Settings } from './screens/Settings';
import { Novidades } from './screens/Novidades';
import { UpdateBanner } from './components/UpdateBanner';

export type Overlay = null | 'settings' | { novidades: string | null };

export function App() {
  const demo = isDemo();
  const screen = demoScreen();
  const [session, setSession] = useState<Session | null>(
    demo && screen !== 'entrada' ? { server: 'demo', name: 'Voce', invite: 'demo' } : null,
  );
  const [roomId, setRoomId] = useState<RoomId>(demo ? 'cs' : 'geral');
  const [overlay, setOverlay] = useState<Overlay>(
    screen === 'config' ? 'settings' : screen === 'novidades' ? { novidades: null } : null,
  );
  const updater = useUpdater(!!session, demo);

  // Opens "Novidades" once after an update.
  useEffect(() => {
    if (demo) return;
    const seen = store.get('versaoVista');
    if (seen && seen !== updater.current) setOverlay({ novidades: seen });
    store.set('versaoVista', updater.current);
  }, [updater.current, demo]);

  const shell = (
    <>
      <UpdateBanner updater={updater} inCall={!!session} room={roomId} onNotes={() => setOverlay({ novidades: null })} />
      <div className="relative min-h-0 flex-1">
        {session ? (
          demo ? (
            <DemoRoom session={session} room={roomId} onRoom={setRoomId} onSettings={() => setOverlay('settings')} onLeave={() => setSession(null)} />
          ) : (
            <LiveRoom session={session} room={roomId} onRoom={setRoomId} onSettings={() => setOverlay('settings')} onLeave={() => setSession(null)} />
          )
        ) : (
          <Login onEnter={setSession} onSettings={() => setOverlay('settings')} />
        )}
        {overlay === 'settings' && (
          <Settings updater={updater} inCall={!!session} onClose={() => setOverlay(null)} onNotes={() => setOverlay({ novidades: null })} />
        )}
        {overlay && typeof overlay === 'object' && (
          <Novidades from={overlay.novidades} current={updater.current} onClose={() => setOverlay(null)} onHistory={() => setOverlay('settings')} />
        )}
      </div>
    </>
  );
  return <div className="flex h-full flex-col overflow-hidden">{shell}</div>;
}
