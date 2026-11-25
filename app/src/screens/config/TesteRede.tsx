import { useState } from 'react';
import { modoFalso } from '../../lib/falso';
import { medirRede, qualidadeRede, type ResultadoRede } from '../../lib/rede';

const TOTAL = 20;

/** Ping and loss to the server, with the numbers in Anton on a lime title bar (data). */
export function TesteRede({ servidorUrl, destaque }: { servidorUrl: string | null; destaque?: boolean }) {
  const [estado, setEstado] = useState<'parado' | number | ResultadoRede | 'falhou'>('parado');
  const medindo = typeof estado === 'number';

  async function testar() {
    if (!servidorUrl) return;
    setEstado(0);
    // Demo: the fake server has no address to measure.
    const r = modoFalso() ? { ping: 142, perda: 0, amostras: TOTAL } : await medirRede(servidorUrl, TOTAL, 150, setEstado);
    setEstado(r ?? 'falhou');
  }

  const resultado = typeof estado === 'object' ? estado : null;
  return (
    <section data-ajuste="voz-rede" aria-label="Teste de rede"
      className={`janela flex flex-col ${destaque ? 'outline-2 outline-offset-2 outline-destaque' : ''}`}>
      <div className="barra barra-lima">Teste de rede<span className="ml-auto font-medium">{servidorUrl ? new URL(servidorUrl).host : 'sem servidor'}</span></div>
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3 p-4">
        <div className="flex gap-8" aria-live="polite">
          <span className="flex flex-col">
            <span className="rotulo">Ping</span>
            <b className="font-display text-[44px] leading-none tabular-nums">{resultado ? resultado.ping : '—'}<span className="ml-1 font-mono text-[12px]">ms</span></b>
          </span>
          <span className="flex flex-col">
            <span className="rotulo">Perda</span>
            <b className="font-display text-[44px] leading-none tabular-nums">{resultado ? resultado.perda.toLocaleString('pt-BR') : '—'}<span className="ml-1 font-mono text-[12px]">%</span></b>
          </span>
        </div>
        <span className="flex min-w-[240px] flex-1 flex-col gap-1 text-[14px]">
          {resultado ? (
            <span className={qualidadeRede(resultado) === 'ruim' ? 'font-bold text-perigo' : ''}>
              Rede {qualidadeRede(resultado)}.{' '}
              {qualidadeRede(resultado) === 'ruim'
                ? 'A voz pode cortar. Na sala, o modo internet ruim prioriza a voz e pausa o vídeo que você recebe.'
                : 'Voz e tela devem ir bem.'}
            </span>
          ) : estado === 'falhou' ? (
            <span role="alert" className="font-bold text-perigo">O servidor não respondeu. Confira a internet e tente de novo.</span>
          ) : (
            <span className="text-texto-fraco">{servidorUrl ? `Manda ${TOTAL} pacotes até o servidor e mede a volta. Leva uns 5 s.` : 'Entre num servidor para testar a rede até ele.'}</span>
          )}
        </span>
        <button type="button" className="btn" disabled={!servidorUrl || medindo} onClick={() => void testar()}>
          {medindo ? `Testando… ${estado}/${TOTAL}` : resultado || estado === 'falhou' ? 'Testar de novo' : 'Testar agora'}
        </button>
      </div>
    </section>
  );
}
