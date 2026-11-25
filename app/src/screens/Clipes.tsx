import { useEffect, useState } from 'react';
import { Faixa } from '../components/Faixa';
import { Icone } from '../components/Icone';
import { replay as nucleo, type Clipe, type ListaClipes } from '../lib/nucleo';

const gb = (b: number) => (b / 1e9).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
const dur = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
function quando(seg: number) {
  const d = new Date(seg * 1000);
  const hoje = new Date();
  const ontem = new Date(Date.now() - 86_400_000);
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === hoje.toDateString()) return `hoje ${hora}`;
  if (d.toDateString() === ontem.toDateString()) return 'ontem';
  return d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
}

/**
 * Clip gallery (film icon on the top bar): the clips saved on this PC, the space used, open the
 * folder and delete. Cutting by track and sending to the chat come with the core contract.
 */
export function Clipes({ onFechar, onReplay }: { onFechar(): void; onReplay(): void }) {
  const [dados, setDados] = useState<ListaClipes | null>(null);
  const [erro, setErro] = useState<string>();
  const [filtro, setFiltro] = useState<'todos' | 'meus' | 'recebidos'>('todos');
  const [aberto, setAberto] = useState<string | null>(null);
  const [apagar, setApagar] = useState(false);

  const carregar = () => {
    setErro(undefined);
    nucleo.listarClipes().then((d) => {
      setDados(d);
      setAberto((a) => a ?? d.clipes[0]?.id ?? null);
    }, (e: unknown) => setErro(`Não deu para ler os clipes. ${e instanceof Error ? e.message : String(e)}`));
  };
  useEffect(carregar, []);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('[role="dialog"][aria-modal="true"]') && onFechar();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onFechar]);

  const todos = dados?.clipes ?? [];
  const meus = todos.filter((c) => c.autor === 'você');
  const lista = filtro === 'meus' ? meus : filtro === 'recebidos' ? todos.filter((c) => c.autor !== 'você') : todos;
  const clipe = todos.find((c) => c.id === aberto);
  const cheio = dados ? dados.usados_bytes >= dados.limite_bytes : false;

  async function apagarClipe(c: Clipe) {
    setApagar(false);
    try {
      await nucleo.apagarClipe(c.id);
      setAberto(null);
      carregar();
    } catch (e) {
      setErro(`Não deu para apagar o clipe. ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return (
    <div role="region" aria-label="Clipes" className="absolute inset-0 z-20 grid grid-cols-[minmax(0,1fr)_540px] gap-4 bg-fundo px-5 pt-4 pb-5 max-[1280px]:grid-cols-[minmax(0,1fr)_420px]">
      <section className="flex min-h-0 flex-col gap-3">
        <header className="flex items-start gap-4">
          <div className="flex flex-col gap-1">
            <span className="rotulo">/ Clipes · salvos neste PC</span>
            <h1 className="text-[56px]">Clipes</h1>
          </div>
          {dados && (
            <div className={`janela ml-auto flex w-[310px] flex-col ${cheio ? 'border-perigo' : ''}`} aria-label="Espaço">
              <div className={`barra ${cheio ? 'barra-ar' : 'barra-lima'}`}>Espaço<span className="ml-auto font-medium">limite {gb(dados.limite_bytes)} GB</span></div>
              <div className="flex flex-col gap-1.5 px-3 py-2">
                <span className="flex items-center gap-3">
                  <b className="font-display text-[36px] leading-none tabular-nums">{gb(dados.usados_bytes)}</b><span className="rotulo">GB</span>
                  <span className="h-2.5 flex-1 border border-texto" aria-hidden="true">
                    <span className="block h-full bg-texto" style={{ width: `${Math.min(100, (dados.usados_bytes / dados.limite_bytes) * 100)}%` }} />
                  </span>
                </span>
                <span className={`text-[12px] ${cheio ? 'font-bold text-perigo' : 'text-texto-fraco'}`}>
                  {cheio ? `Limite de ${gb(dados.limite_bytes)} GB cheio. O clipe mais antigo vai sair no próximo.` : `${todos.length} clipes · o mais antigo sai quando encher`}
                </span>
              </div>
            </div>
          )}
          <button type="button" className="btn btn-icone" aria-label="Fechar clipes" title="Fechar (Esc)" onClick={onFechar}><Icone nome="fechar" /></button>
        </header>
        {erro && <Faixa acoes={[{ rotulo: 'Tentar de novo', onClick: carregar }]} onFechar={() => setErro(undefined)}>{erro}</Faixa>}
        <div className="flex flex-wrap items-center gap-3">
          <div className="abas" role="group" aria-label="Filtro">
            {([['todos', `Todos · ${todos.length}`], ['meus', `Meus · ${meus.length}`], ['recebidos', `Recebidos · ${todos.length - meus.length}`]] as const).map(([id, t]) => (
              <button key={id} type="button" aria-pressed={filtro === id} onClick={() => setFiltro(id)}>{t}</button>
            ))}
          </div>
          <button type="button" className="btn btn-fant ml-auto" onClick={() => void nucleo.abrirPastaClipes()}><Icone nome="pasta" />Abrir pasta</button>
        </div>
        {dados === null && !erro ? (
          <div className="grid grid-cols-3 gap-3" aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-[160px]" />)}</div>
        ) : todos.length === 0 ? (
          <div className="janela flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <b className="font-display text-[28px]">Nenhum clipe ainda</b>
            <span className="max-w-[48ch] text-[14px] text-texto-fraco">Ligue o replay e use o botão Clipe depois de uma jogada boa.</span>
            <button type="button" className="btn btn-prim" onClick={onReplay}><Icone nome="replay" />Ligar replay</button>
          </div>
        ) : (
          <ul className="m-0 grid min-h-0 list-none grid-cols-[repeat(auto-fill,minmax(220px,1fr))] content-start gap-3 overflow-y-auto p-0 pb-1">
            {lista.map((c) => (
              <li key={c.id}>
                <button type="button" aria-pressed={c.id === aberto} onClick={() => { setAberto(c.id); setApagar(false); }}
                  className={`janela flex w-full flex-col p-0 text-left ${c.id === aberto ? 'outline-[3px] outline-offset-[-1px] outline-destaque' : 'hover:bg-superficie-alta'}`}>
                  <span className="relative block aspect-video w-full bg-palco">
                    <span className="absolute top-2 right-2 bg-texto px-1.5 py-0.5 font-mono text-[12px] font-bold text-superficie">{dur(c.duracao_s)}</span>
                  </span>
                  <span className="flex flex-col gap-0.5 border-t border-texto px-3 py-2">
                    <b className="truncate text-[15px]">{c.titulo}</b>
                    <span className="truncate text-[12px] text-texto-fraco">{[c.autor, c.jogo, quando(c.criado_em)].filter(Boolean).join(' · ')}</span>
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
            <div className="barra"><span className="truncate">{clipe.titulo}</span><span className="ml-auto font-medium normal-case">{dur(clipe.duracao_s)} · {Math.round(clipe.bytes / 1e6)} MB</span></div>
            <div className="relative grid min-h-0 flex-1 place-items-center bg-palco">
              {clipe.url ? <video key={clipe.id} src={clipe.url} controls className="absolute inset-0 size-full object-contain" />
                : <span className="px-6 text-center text-[14px] text-sobre-palco">A prévia aparece no app instalado.</span>}
            </div>
            <div className="flex flex-col gap-2 border-t border-texto p-3">
              {apagar ? (
                <div role="alertdialog" aria-label="Apagar clipe" className="flex flex-wrap items-center gap-2 border border-perigo p-2.5">
                  <span className="flex-1 text-[13px]">Apagar <b>{clipe.titulo}</b> deste PC? Não dá para desfazer.</span>
                  <button type="button" className="btn btn-sm border-perigo text-perigo" onClick={() => void apagarClipe(clipe)}>Apagar</button>
                  <button type="button" className="btn btn-sm" onClick={() => setApagar(false)}>Cancelar</button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <button type="button" className="btn flex-1" onClick={() => void nucleo.abrirPastaClipes(clipe.id)}><Icone nome="pasta" />Mostrar na pasta</button>
                  <button type="button" className="btn btn-icone text-perigo" aria-label={`Apagar ${clipe.titulo}`} title="Apagar" onClick={() => setApagar(true)}><Icone nome="lixo" /></button>
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
