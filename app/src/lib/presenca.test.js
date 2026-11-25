import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { agendarPresenca } from './presenca';
const tick = (ms) => vi.advanceTimersByTimeAsync(ms);
describe('agendamento de presença', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());
    it('agrupa eventos com um segundo de debounce', async () => {
        const atualizar = vi.fn(async () => false);
        const agenda = agendarPresenca(atualizar, true);
        agenda.avisar();
        await tick(800);
        agenda.avisar();
        await tick(999);
        expect(atualizar).not.toHaveBeenCalled();
        await tick(1);
        expect(atualizar).toHaveBeenCalledTimes(1);
        agenda.parar();
    });
    it('consulta a cada 20 s visível, a cada 60 s oculto e ao voltar', async () => {
        const atualizar = vi.fn(async () => false);
        const agenda = agendarPresenca(atualizar, true);
        await tick(19_999);
        expect(atualizar).not.toHaveBeenCalled();
        await tick(1);
        expect(atualizar).toHaveBeenCalledTimes(1);
        agenda.visibilidade(false);
        await tick(59_999);
        expect(atualizar).toHaveBeenCalledTimes(1);
        await tick(1);
        expect(atualizar).toHaveBeenCalledTimes(2);
        agenda.visibilidade(true);
        await tick(1000);
        expect(atualizar).toHaveBeenCalledTimes(3);
        agenda.parar();
        await tick(60_000);
        expect(atualizar).toHaveBeenCalledTimes(3);
    });
    it('reserva parte do limite por minuto para as outras rotas', async () => {
        const atualizar = vi.fn(async () => false);
        const agenda = agendarPresenca(atualizar, true);
        for (let i = 0; i < 12; i++) {
            agenda.avisar();
            await tick(1000);
        }
        expect(atualizar).toHaveBeenCalledTimes(10);
        await tick(49_000);
        expect(atualizar).toHaveBeenCalledTimes(11);
        agenda.parar();
    });
    it('espera o pedido em curso e recua um minuto se houver 429', async () => {
        let terminar;
        const atualizar = vi.fn(async () => false)
            .mockImplementationOnce(() => new Promise((resolve) => { terminar = resolve; }));
        const agenda = agendarPresenca(atualizar, true);
        agenda.avisar();
        await tick(1000);
        agenda.avisar();
        await tick(25_000);
        expect(atualizar).toHaveBeenCalledTimes(1);
        terminar(true);
        await tick(59_999);
        expect(atualizar).toHaveBeenCalledTimes(1);
        await tick(1);
        expect(atualizar).toHaveBeenCalledTimes(2);
        agenda.parar();
    });
});
