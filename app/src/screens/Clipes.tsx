import { useEffect, useState } from 'react';
import { Faixa } from '../components/Faixa';
import { Icone } from '../components/Icone';
import { lerClipes, mostrarNaPasta, tirarClipe, titulo, type Clipe } from '../lib/clipes';
import { replay } from '../lib/nucleo';

const mb = (b: number) => Math.round(b / 1e6).toLocaleString('pt-BR');
const dur = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
function quando(ms: number) {
  const d = new Date(ms);
  const hoje = new Date();
  const ontem = new Date(Date.now() - 86_400_000);
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === hoje.toDateString()) return `hoje ${hora}`;
  if (d.toDateString() === ontem.toDateString()) return `ontem ${hora}`;
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

/**
 * Clip gallery (film icon on the top bar): the clips this PC saved, newest first. The files live in
 * Vídeos\Stackcall; "Mostrar na pasta" opens the Explorer there. The core has no delete command, so
 * "Tirar da lista" only hides the clip here.
 */
export function Clipes({ onFechar, onReplay }: { onFechar(): void; onReplay(): void }) {
  const [clipes, setClipes] = useState(lerClipes);
  const [aberto, setAberto] = useState<string | null>(() => lerClipes()[0]?.caminho ?? null);
  const [erro, setErro] = useState<string>();

  // A clip saved while the gallery is open shows up at once.
  useEffect(() => replay.aoEvento((e) => {
    if (e.event === 'saved') queueMicrotask(() => setClipes(lerClipes()));
    if (e.event === 'error') setErro(`O replay parou. ${e.motivo}`);
  }), []);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('[role="dialog"][aria-modal="true"]') && onFechar();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onFechar]);

  const clipe = clipes.find((c) => c.caminho === aberto);
  const total = clipes.reduce((n, c) => n + c.tamanho, 0);
  const mostrar = (c: Clipe) => mostrarNaPasta(c.caminho).catch((e: unknown) => setErro(`Não deu para abrir a pasta. ${e instanceof Error ? e.message : String(e)}`));
  const tirar = (c: Clipe) => {
    tirarClipe(c.caminho);
    const resto = lerClipes();
    setClipes(resto);
    setAberto(resto[0]?.caminho ?? null);
  };

  return (
    <div role="region" aria-label="Clipes" className="absolute inset-0 z-20 grid grid-cols-[minmax(0,1fr)_540px] gap-4 bg-fundo px-5 pt-4 pb-5 max-[1280px]:grid-cols-[minmax(0,1fr)_420px]">
      <section className="flex min-h-0 flex-col gap-3">
        <header className="flex items-start gap-4">
          <div className="flex flex-col gap-1">
            <span className="rotulo">/ Clipes · salvos neste PC, em Vídeos\Stackcall</span>
            <h1 className="text-[56px]">Clipes</h1>
          </div>
          {clipes.length > 0 && (
            <div className="janela ml-auto flex w-[260px] flex-col" aria-label="Espaço">
              <div className="barra barra-lima">Espaço</div>
              <div className="flex items-center gap-2 px-3 py-2">
                <b className="font-display text-[36px] leading-none tabular-nums">{mb(total)}</b><span className="rotulo">MB em {clipes.length} clipes</span>
              </div>
            </div>
          )}
          <button type="button" className={`btn btn-icone ${clipes.length ? '' : 'ml-auto'}`} aria-label="Fechar clipes" title="Fechar (Esc)" onClick={onFechar}><Icone nome="fechar" /></button>
        </header>
        {erro && <Faixa onFechar={() => setErro(undefined)}>{erro}</Faixa>}
        {clipes.length === 0 ? (
          <div className="janela flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <b className="font-display text-[28px]">Nenhum clipe ainda</b>
            <span className="max-w-[48ch] text-[14px] text-texto-fraco">Ligue o replay e use o botão Clipe depois de uma jogada boa.</span>
            <button type="button" className="btn btn-prim" onClick={onReplay}><Icone nome="replay" />Ligar replay</button>
          </div>
        ) : (
          <ul className="m-0 grid min-h-0 list-none grid-cols-[repeat(auto-fill,minmax(220px,1fr))] content-start gap-3 overflow-y-auto p-0 pb-1">
            {clipes.map((c) => (
              <li key={c.caminho}>
                <button type="button" aria-pressed={c.caminho === aberto} onClick={() => setAberto(c.caminho)}
                  className={`janela flex w-full flex-col p-0 text-left ${c.caminho === aberto ? 'outline-[3px] outline-offset-[-1px] outline-destaque' : 'hover:bg-superficie-alta'}`}>
                  <span className="relative block aspect-video w-full bg-palco">
                    <span className="absolute top-2 right-2 bg-texto px-1.5 py-0.5 font-mono text-[12px] font-bold text-superficie">{dur(c.duracao)}</span>
                  </span>
                  <span className="flex flex-col gap-0.5 border-t border-texto px-3 py-2">
                    <b className="truncate text-[15px]">{titulo(c)}</b>
                    <span className="truncate text-[12px] text-texto-fraco">{quando(c.em)} · {mb(c.tamanho)} MB</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <aside className="janela flex min-h-0 flex-col" aria-label="Clipe aberto">
        {clipe ? (
          <>
            <div className="barra"><span className="truncate">{titulo(clipe)}</span><span className="ml-auto font-medium normal-case">{dur(clipe.duracao)} · {mb(clipe.tamanho)} MB</span></div>
            <div className="grid min-h-0 flex-1 place-items-center bg-palco px-6 text-center">
              <span className="flex flex-col gap-2 text-sobre-palco">
                <span className="text-[14px]">Duas faixas de som: tudo junto (jogo, call e microfone) e só as vozes.</span>
                <span className="font-mono text-[12px] break-all opacity-80">{clipe.caminho}</span>
              </span>
            </div>
            <div className="flex gap-2 border-t border-texto p-3">
              <button type="button" className="btn flex-1" onClick={() => void mostrar(clipe)}><Icone nome="pasta" />Mostrar na pasta</button>
              <button type="button" className="btn" title="O arquivo continua na pasta" onClick={() => tirar(clipe)}><Icone nome="lixo" />Tirar da lista</button>
            </div>
          </>
        ) : (
          <p className="m-auto px-6 text-center text-[14px] text-texto-fraco">Escolha um clipe para ver aqui.</p>
        )}
      </aside>
    </div>
  );
}
