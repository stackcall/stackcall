import { useEffect, useState } from 'react';
import { Faixa } from '../components/Faixa';
import { ACOES, aoMudarAtalhos, conflitos, gravarAtalho, lerAtalhos, salvarAtalhos, semModificador, type AcaoId } from '../lib/atalhos';
import { tocarSom } from '../lib/sons';
import { lerVoz } from '../lib/voz';

const rotuloDe = (id: AcaoId) => ACOES.find((a) => a.id === id)?.rotulo ?? id;

/** Settings > Atalhos: one row per action with its combination, record, clear and conflicts. */
export function SecaoAtalhos() {
  const [cfg, setCfg] = useState(lerAtalhos);
  const [gravando, setGravando] = useState<AcaoId | null>(null);
  const [erro, setErro] = useState<string>();
  useEffect(() => aoMudarAtalhos(setCfg), []);
  const choques = conflitos(cfg.teclas);
  const ptt = lerVoz().modo === 'ptt';

  async function gravar(id: AcaoId) {
    setErro(undefined);
    setGravando(id);
    try {
      const teclas = await gravarAtalho();
      if (teclas) salvarAtalhos({ teclas: { ...lerAtalhos().teclas, [id]: teclas } });
    } catch (e) {
      setErro(`Não deu para gravar o atalho. ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setGravando(null);
    }
  }
  const limpar = (id: AcaoId) => {
    const teclas = { ...lerAtalhos().teclas };
    delete teclas[id];
    salvarAtalhos({ teclas });
  };

  return (
    <>
      <header className="flex flex-col gap-1.5">
        <h1 className="text-[56px]">Atalhos</h1>
        <p className="m-0 max-w-[72ch] text-texto-fraco">
          Funcionam com o jogo na frente, sem Alt+Tab. Nenhum vem ligado: escolha teclas que o seu jogo não usa.
          Com o app em foco, M, S e T continuam valendo.
        </p>
      </header>

      {erro && <Faixa onFechar={() => setErro(undefined)}>{erro}</Faixa>}

      <section className="janela flex flex-col" aria-label="Atalhos globais">
        <div className="barra">Ações<span className="ml-auto font-medium">{Object.keys(cfg.teclas).length} de {ACOES.length} com atalho</span></div>
        <ul className="m-0 list-none p-0">
          {ACOES.map((a) => {
            const teclas = cfg.teclas[a.id];
            const choque = choques[a.id];
            const agora = gravando === a.id;
            return (
              <li key={a.id} data-gravando={agora || undefined} className="grid grid-cols-[minmax(0,1fr)_200px_auto] items-center gap-x-4 gap-y-1 border-t border-borda px-4 py-2.5 first:border-t-0">
                <span className="flex min-w-0 flex-col">
                  <b className="text-[15px]">{a.rotulo}{a.segurar && <span className="ml-2 text-[12px] font-medium text-texto-fraco">segurar</span>}</b>
                  <span className="text-[13px] text-texto-fraco">
                    {a.ajuda}
                    {a.id === 'falar' && !ptt && ' O modo atual é Detecção de voz.'}
                  </span>
                </span>
                <span className="flex min-w-0 flex-col items-start" aria-live="polite">
                  {agora ? (
                    <span className="flex h-9 w-full items-center border border-destaque px-2 text-[13px] font-bold text-destaque">Aperte as teclas… (Esc cancela)</span>
                  ) : teclas ? (
                    <kbd className={`inline-flex h-9 max-w-full items-center truncate border px-2 font-mono text-[13px] font-bold ${choque ? 'border-perigo text-perigo' : 'border-texto bg-superficie-alta'}`}>{teclas}</kbd>
                  ) : (
                    <span className="text-[13px] text-texto-fraco">Sem atalho · sugestão <span className="font-mono">{a.sugestao}</span></span>
                  )}
                </span>
                <span className="flex gap-2">
                  <button type="button" className="btn btn-sm" disabled={gravando !== null} onClick={() => void gravar(a.id)}
                    aria-label={`Gravar atalho para ${a.rotulo}`}>{teclas ? 'Trocar' : 'Gravar'}</button>
                  <button type="button" className="btn btn-sm btn-fant" disabled={!teclas || gravando !== null} onClick={() => limpar(a.id)}
                    aria-label={`Limpar atalho de ${a.rotulo}`}>Limpar</button>
                </span>
                {choque && (
                  <p role="alert" className="col-span-3 m-0 text-[13px] font-bold text-perigo">
                    Mesmo atalho de {choque.map(rotuloDe).join(' e ')}. Só uma ação deve usar cada combinação.
                  </p>
                )}
                {teclas && !choque && semModificador(teclas) && (
                  <p className="col-span-3 m-0 text-[13px] text-texto-fraco">
                    Sem Ctrl, Alt ou Shift, a tecla {teclas} deixa de funcionar no jogo e no chat enquanto o atalho existir.
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="janela flex items-center gap-4 px-4 py-3" aria-label="Som de confirmação">
        <span className="flex flex-1 flex-col gap-0.5">
          <b>Som de confirmação</b>
          <span className="text-[13px] text-texto-fraco">Um bipe curto quando um atalho liga, desliga ou silencia: no jogo você não vê o app.</span>
        </span>
        <button type="button" className="btn btn-sm btn-fant" onClick={() => tocarSom('liga')}>Ouvir</button>
        <button type="button" role="switch" aria-checked={cfg.som} aria-label="Som de confirmação" onClick={() => salvarAtalhos({ som: !cfg.som })}
          className={`btn btn-sm w-[88px] ${cfg.som ? 'bg-texto text-superficie' : ''}`}>{cfg.som ? 'Ligado' : 'Desligado'}</button>
      </section>
    </>
  );
}
