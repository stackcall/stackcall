import { useCallback, useEffect, useState } from 'react';
import { Faixa } from '../components/Faixa';
import { Icone } from '../components/Icone';
import { apagarClipe, listarClipes, mostrarNaPasta, titulo, type Clipe } from '../lib/clipes';
import { replay } from '../lib/nucleo';

const mb = (b: number) => Math.round(b / 1e6).toLocaleString('pt-BR');
const dur = (s: number | null) => (s === null ? '—' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`);
const erroDe = (e: unknown) => (e instanceof Error ? e.message : String(e));
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
 * Clip gallery (film icon on the top bar): the MP4 files in Vídeos\Stackcall, newest first, as
 * the core lists them. "Apagar" sends the file to the Recycle Bin after a confirmation.
 */
export function Clipes({ onFechar, onReplay }: { onFechar(): void; onReplay(): void }) {
  const [clipes, setClipes] = useState<Clipe[] | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);
  const [apagar, setApagar] = useState(false);
  const [erro, setErro] = useState<string>();

  const carregar = useCallback(() => {
    listarClipes().then((lista) => {
      setClipes(lista);
      setAberto((a) => (lista.some((c) => c.nome === a) ? a : lista[0]?.nome ?? null));
    }, (e: unknown) => setErro(`Não deu para ler a pasta dos clipes. ${erroDe(e)}`));
  }, []);
  // Reload on open and when the core saves a new clip.
  useEffect(() => {
    carregar();
    return replay.aoEvento((e) => {
      if (e.event === 'saved') carregar();
      if (e.event === 'error') setErro(`O replay parou. ${e.motivo}`);
    });
  }, [carregar]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('[role="dialog"][aria-modal="true"]') && onFechar();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onFechar]);

  const lista = clipes ?? [];
  const clipe = lista.find((c) => c.nome === aberto);
  const total = lista.reduce((n, c) => n + c.tamanho, 0);
  const mostrar = (c: Clipe) => mostrarNaPasta(c).catch((e: unknown) => setErro(`Não deu para abrir a pasta. ${erroDe(e)}`));
  async function confirmarApagar(c: Clipe) {
    setApagar(false);
    try {
      await apagarClipe(c);
      carregar();
    } catch (e) {
      setErro(`Não deu para apagar o clipe; ele continua na pasta. ${erroDe(e)}`);
    }
  }

  return (
    <div role="region" aria-label="Clipes" className="absolute inset-0 z-20 grid grid-cols-[minmax(0,1fr)_540px] gap-4 bg-fundo px-5 pt-4 pb-5 max-[1280px]:grid-cols-[minmax(0,1fr)_420px]">
      <section className="flex min-h-0 flex-col gap-3">
        <header className="flex items-start gap-4">
          <div className="flex flex-col gap-1">
            <span className="rotulo">/ Clipes · salvos neste PC, em Vídeos\Stackcall</span>
            <h1 className="text-[56px]">Clipes</h1>
          </div>
          {lista.length > 0 && (
            <div className="janela ml-auto flex w-[260px] flex-col" aria-label="Espaço">
              <div className="barra barra-lima">Espaço</div>
              <div className="flex items-center gap-2 px-3 py-2">
                <b className="font-display text-[36px] leading-none tabular-nums">{mb(total)}</b><span className="rotulo">MB em {lista.length} clipes</span>
              </div>
            </div>
          )}
          <button type="button" className={`btn btn-icone ${lista.length ? '' : 'ml-auto'}`} aria-label="Fechar clipes" title="Fechar (Esc)" onClick={onFechar}><Icone nome="fechar" /></button>
        </header>
        {erro && <Faixa acoes={[{ rotulo: 'Tentar de novo', onClick: () => { setErro(undefined); carregar(); } }]} onFechar={() => setErro(undefined)}>{erro}</Faixa>}
        {clipes === null && !erro ? (
          <div className="grid grid-cols-3 gap-3" aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-[160px]" />)}</div>
        ) : lista.length === 0 ? (
          <div className="janela flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <b className="font-display text-[28px]">Nenhum clipe ainda</b>
            <span className="max-w-[48ch] text-[14px] text-texto-fraco">Ligue o replay e use o botão Clipe depois de uma jogada boa.</span>
            <button type="button" className="btn btn-prim" onClick={onReplay}><Icone nome="replay" />Ligar replay</button>
          </div>
        ) : (
          <ul className="m-0 grid min-h-0 list-none grid-cols-[repeat(auto-fill,minmax(220px,1fr))] content-start gap-3 overflow-y-auto p-0 pb-1">
            {lista.map((c) => (
              <li key={c.nome}>
                <button type="button" aria-pressed={c.nome === aberto} onClick={() => { setAberto(c.nome); setApagar(false); }}
                  className={`janela flex w-full flex-col p-0 text-left ${c.nome === aberto ? 'outline-[3px] outline-offset-[-1px] outline-destaque' : 'hover:bg-superficie-alta'}`}>
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
            <div className="flex flex-col gap-2 border-t border-texto p-3">
              {apagar ? (
                <div role="alertdialog" aria-label="Apagar clipe" className="flex flex-wrap items-center gap-2 border border-perigo p-2.5">
                  <span className="flex-1 text-[13px]">Mandar <b>{titulo(clipe)}</b> para a Lixeira?</span>
                  <button type="button" className="btn btn-sm border-perigo text-perigo" onClick={() => void confirmarApagar(clipe)}>Apagar</button>
                  <button type="button" className="btn btn-sm" onClick={() => setApagar(false)}>Cancelar</button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <button type="button" className="btn flex-1" onClick={() => void mostrar(clipe)}><Icone nome="pasta" />Mostrar na pasta</button>
                  <button type="button" className="btn text-perigo" onClick={() => setApagar(true)}><Icone nome="lixo" />Apagar</button>
                </div>
              )}
            </div>
          </>
        ) : (
          <p className="m-auto px-6 text-center text-[14px] text-texto-fraco">Escolha um clipe para ver aqui.</p>
        )}
      </aside>
    </div>
  );
}
