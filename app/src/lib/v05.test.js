import { buscarAjustes, normalizar, paginasVisiveis, PAGINAS } from './buscaConfig';
import { CHAVE_PREFERENCIAS, PREFERENCIAS_PADRAO, aoMudarPreferencias, lerPreferencias, salvarPreferencias, validarPreferencias } from './preferencias';
import { linhasQuemFala, ESTADO_EXEMPLO } from './quemfala';
import { envioDoJogo, duracaoJogo, RENOVAR_MS } from './jogo';
import { resumoRede } from './rede';
beforeEach(() => localStorage.clear());
describe('busca em Configurações', () => {
    test('acha por nome, apelido e descrição, sem acento nem caixa', () => {
        expect(buscarAjustes('ptt').map((a) => a.id)).toContain('voz-modo');
        expect(buscarAjustes('GRAVACAO')[0].id).toBe('replay-ligado');
        expect(buscarAjustes('notificacao').map((a) => a.id)).toEqual(['cutucar-aviso']);
        expect(normalizar('  Opacidade ÇÃ ')).toBe('opacidade ca');
    });
    test('o nome pesa mais que o apelido e toda palavra precisa casar', () => {
        expect(buscarAjustes('eco')[0].id).toBe('voz-eco');
        expect(buscarAjustes('janela opacidade').map((a) => a.id)).toEqual(['quemfala-opacidade']);
        expect(buscarAjustes('xyz')).toEqual([]);
        expect(buscarAjustes('   ')).toEqual([]);
    });
    test('membro não vê o grupo Servidor nem acha ajustes dele', () => {
        const membro = paginasVisiveis(true, false).map((p) => p.id);
        expect(membro).not.toContain('membros');
        expect(buscarAjustes('convites', membro)).toEqual([]);
        expect(buscarAjustes('convites', paginasVisiveis(true, true).map((p) => p.id))[0].pagina).toBe('geral');
        expect(paginasVisiveis(false, false).map((p) => p.id)).not.toContain('perfil');
    });
    test('todo ajuste aponta para uma página que existe', () => {
        const ids = new Set(PAGINAS.map((p) => p.id));
        expect(buscarAjustes('a').every((a) => ids.has(a.pagina))).toBe(true);
    });
});
describe('preferências', () => {
    test('padrão sem nada salvo; campo inválido volta ao padrão sozinho', () => {
        expect(lerPreferencias()).toEqual(PREFERENCIAS_PADRAO);
        localStorage.setItem(CHAVE_PREFERENCIAS, JSON.stringify({ replaySegundos: 45, quemFalaOpacidade: 5, cutucarVolume: 140.4, quemFalaTamanho: 'g', cutucarVoz: 'sim' }));
        const p = lerPreferencias();
        expect(p.replaySegundos).toBe(60);
        expect(p.quemFalaOpacidade).toBe(20);
        expect(p.cutucarVolume).toBe(100);
        expect(p.quemFalaTamanho).toBe('g');
        expect(p.cutucarVoz).toBe(true);
        localStorage.setItem(CHAVE_PREFERENCIAS, '{quebrado');
        expect(lerPreferencias()).toEqual(PREFERENCIAS_PADRAO);
        expect(validarPreferencias(null)).toEqual(PREFERENCIAS_PADRAO);
    });
    test('salvar avisa esta janela e as outras (evento storage)', () => {
        const visto = vi.fn();
        const parar = aoMudarPreferencias(visto);
        salvarPreferencias({ quemFalaMostrar: true });
        expect(visto).toHaveBeenLastCalledWith(expect.objectContaining({ quemFalaMostrar: true }));
        localStorage.setItem(CHAVE_PREFERENCIAS, JSON.stringify({ quemFalaOpacidade: 40 }));
        window.dispatchEvent(new StorageEvent('storage', { key: CHAVE_PREFERENCIAS }));
        expect(visto).toHaveBeenLastCalledWith(expect.objectContaining({ quemFalaOpacidade: 40 }));
        parar();
        salvarPreferencias({ quemFalaMostrar: false });
        expect(visto).toHaveBeenCalledTimes(2);
    });
});
describe('janela quem fala', () => {
    test('todos mostra a sala inteira; só quem fala filtra; fora da voz não mostra nada', () => {
        expect(linhasQuemFala(ESTADO_EXEMPLO, 'todos')).toHaveLength(4);
        expect(linhasQuemFala(ESTADO_EXEMPLO, 'falando').map((p) => p.nome)).toEqual(['Duda', 'Rafa']);
        expect(linhasQuemFala(null, 'todos')).toEqual([]);
    });
});
describe('jogo na presença', () => {
    test('manda ao mudar, renova a cada 60 s, limpa uma vez quando o jogo fecha', () => {
        expect(envioDoJogo(null, null, 0)).toBeNull();
        expect(envioDoJogo(' Counter-Strike 2 ', null, 0)).toBe('Counter-Strike 2');
        const ultimo = { jogo: 'Counter-Strike 2', em: 0 };
        expect(envioDoJogo('Counter-Strike 2', ultimo, RENOVAR_MS - 1)).toBeNull();
        expect(envioDoJogo('Counter-Strike 2', ultimo, RENOVAR_MS)).toBe('Counter-Strike 2');
        expect(envioDoJogo(null, ultimo, 10)).toBe('');
        expect(envioDoJogo(null, { jogo: '', em: 10 }, RENOVAR_MS * 5)).toBeNull();
        expect(envioDoJogo('x'.repeat(80), null, 0)).toHaveLength(60);
    });
    test('duração em texto curto', () => {
        expect(duracaoJogo(30_000)).toBe('agora');
        expect(duracaoJogo(40 * 60_000)).toBe('40 min');
        expect(duracaoJogo(72 * 60_000)).toBe('1 h 12');
        expect(duracaoJogo(120 * 60_000)).toBe('2 h');
    });
});
test('teste de rede: mediana do ping e perda em %', () => {
    expect(resumoRede([100, null, 140, 120, null])).toEqual({ ping: 120, perda: 40, amostras: 5 });
    expect(resumoRede([100, 140])?.ping).toBe(120);
    expect(resumoRede([null, null])).toBeNull();
});
