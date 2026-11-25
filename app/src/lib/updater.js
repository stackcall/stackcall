import { useCallback, useEffect, useRef, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { isTauri } from '@tauri-apps/api/core';
import { relaunch } from '@tauri-apps/plugin-process';
import { check } from '@tauri-apps/plugin-updater';
import { UPDATE_CHECK_MS, store } from './config';
export function useUpdater(inCall, demo) {
    const [state, setState] = useState({
        current: __APP_VERSION__, available: null, status: 'idle', progress: null, lastCheck: null, waitingForLeave: false,
    });
    const update = useRef(null);
    const patch = (p) => setState((s) => ({ ...s, ...p }));
    const runCheck = useCallback(async () => {
        if (demo) {
            // Fake server only: offer the next minor so the banner shows a newer version than the installed one.
            const [major, minor] = __APP_VERSION__.split('.').map(Number);
            patch({ available: { version: `${major}.${minor + 1}.0`, notes: '3 novidades, 1 correção' }, lastCheck: new Date() });
            return;
        }
        if (!isTauri())
            return;
        patch({ status: 'checking', error: undefined });
        try {
            const found = await check();
            update.current = found;
            patch({
                available: found ? { version: found.version, date: found.date, notes: found.body } : null,
                status: found ? 'idle' : 'uptodate',
                lastCheck: new Date(),
            });
        }
        catch (error) {
            patch({ status: 'error', error: String(error), lastCheck: new Date() });
        }
    }, [demo]);
    useEffect(() => {
        if (isTauri())
            getVersion().then((current) => patch({ current }));
        void runCheck();
        const id = setInterval(runCheck, UPDATE_CHECK_MS);
        return () => clearInterval(id);
    }, [runCheck]);
    const download = async (found) => {
        let total = 0;
        let done = 0;
        patch({ status: 'downloading', progress: 0 });
        await found.download((event) => {
            if (event.event === 'Started')
                total = event.data.contentLength ?? 0;
            if (event.event === 'Progress') {
                done += event.data.chunkLength;
                patch({ progress: total ? done / total : null });
            }
        });
        patch({ status: 'ready', progress: 1 });
    };
    const install = async (found) => {
        patch({ status: 'installing' });
        store.set('versaoAnterior', state.current);
        await found.install(); // Windows: the NSIS installer closes the app
        await relaunch();
    };
    const apply = useCallback(async () => {
        const found = update.current;
        if (!found)
            return;
        try {
            if (state.status !== 'ready')
                await download(found);
            if (inCall)
                patch({ waitingForLeave: true });
            else
                await install(found);
        }
        catch (error) {
            patch({ status: 'error', error: String(error) });
        }
    }, [inCall, state.status, state.current]);
    // "Atualizar ao sair da sala": install as soon as the call ends.
    useEffect(() => {
        if (!inCall && state.waitingForLeave && update.current) {
            patch({ waitingForLeave: false });
            install(update.current).catch((error) => patch({ status: 'error', error: String(error) }));
        }
    }, [inCall, state.waitingForLeave]);
    return { ...state, check: runCheck, apply };
}
