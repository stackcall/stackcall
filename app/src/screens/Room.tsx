import { useMemo, useState } from 'react';
import { Avatar, corDe, inicial } from '../components/Avatar';
import { Faixa } from '../components/Faixa';
import { Icone } from '../components/Icone';
import type { Pessoa, Sala, Servidor, Usuario } from '../lib/servidor';
import { useDemoRoom } from '../room/demo';
import { useLiveRoom } from '../room/useLiveRoom';
import { useReconexao } from '../room/reconexao';
import { Atalhos, RoomView, Vazio } from './sala/Sala';

export type RoomProps = {
  servidor: Servidor;
  nomeServidor: string;
  eu: Usuario;
  salas: Sala[];
  pessoas: Pessoa[];
  sala: string | null;
  demo: boolean;
  onSala(id: string | null): void;
  onPresenceChange?(): void;
  onConfig(): void;
  onPerfil(): void;
  onCartao(id: string): void;
  onConvidar(): Promise<void>;
  onAmigo(id: string, sim: boolean): void;
};

export type ComSala = Omit<RoomProps, 'sala'> & { sala: Sala };

/** Top bar, then either the lobby (not in voice) or the live room. */
export function RoomScreen(props: RoomProps) {
  const ativa = props.salas.find((s) => s.id === props.sala);
  return (
    <div className="grid h-full grid-rows-[auto_minmax(0,1fr)] gap-4 overflow-hidden px-5 pt-4 pb-5">
      <Topo {...props} />
      {ativa ? (
        props.demo ? <DemoRoom key={ativa.id} {...props} sala={ativa} /> : <LiveRoom key={ativa.id} {...props} sala={ativa} />
      ) : (
        <Saguao {...props} />
      )}
    </div>
  );
}

function LiveRoom(props: ComSala) {
  const [tentativa, setTentativa] = useState(0);
  const session = useMemo(() => ({ servidor: props.servidor }), [props.servidor, tentativa]);
  const model = useLiveRoom(session, props.sala.id, props.onPresenceChange);
  const rec = useReconexao(model.state, model.autoRetry !== false, () => setTentativa((n) => n + 1));
  return <RoomView {...props} model={model} reconexao={rec} onRetry={rec.reconectar} />;
}


function DemoRoom(props: ComSala) {
  const model = useDemoRoom(props.sala.id, { id: props.eu.id, name: props.eu.nome });
  return <RoomView {...props} model={model} reconexao={{ falhas: 0, esgotou: true }} onRetry={() => undefined} />;
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

function Topo({ nomeServidor, salas, sala, pessoas, onSala, onConfig, onPerfil, eu }: RoomProps) {
  const online = pessoas.filter((p) => p.online).length;
  return (
    <header className="flex min-w-0 items-center gap-3">
      <div className="janela flex h-[52px] shrink-0 items-center gap-3 pr-1 pl-3">
        <span className="font-display text-[26px] leading-none">stack<span className="text-destaque">call</span></span>
        <span aria-hidden="true" className="h-[26px] w-px bg-texto" />
        <button type="button" onClick={onConfig} className="flex h-11 flex-col items-start justify-center border-0 bg-transparent px-2 text-left leading-[1.15] hover:bg-superficie-alta"
          aria-label={`Servidor ${nomeServidor}, ${plural(pessoas.length, 'membro', 'membros')}. Abrir configurações do servidor`}>
          <b className="max-w-[180px] truncate text-[14px]">{nomeServidor}</b>
          <span className="rotulo text-[11px]">{plural(pessoas.length, 'membro', 'membros')} · {online} online</span>
        </button>
      </div>

      <nav aria-label="Salas" className="janela flex min-w-0 overflow-x-auto">
        {salas.map((r) => {
          const ativa = r.id === sala;
          const ponto = r.noAr ? 'bg-destaque' : r.pessoas > 0 ? 'bg-lima outline outline-1 outline-texto' : 'bg-borda';
          const dica = r.noAr ? 'alguém no ar' : r.pessoas > 0 ? 'tem gente' : 'vazia';
          return (
            <button key={r.id} type="button" aria-current={ativa ? 'true' : undefined} onClick={() => onSala(r.id)}
              aria-label={`Sala ${r.nome}, ${plural(r.pessoas, 'pessoa', 'pessoas')}, ${dica}${ativa ? ', você está aqui' : ''}`}
              className={`flex h-[50px] min-w-[104px] shrink-0 flex-col items-start justify-center border-0 px-3 text-left [&+&]:border-l [&+&]:border-texto ${ativa ? 'bg-texto text-superficie' : 'bg-transparent hover:bg-superficie-alta'}`}>
              <span className="flex w-full items-center gap-2">
                <b className="max-w-[140px] truncate text-[14px]">{r.nome}</b>
                <span aria-hidden="true" className={`ml-auto inline-block size-2 shrink-0 ${ponto}`} />
              </span>
              <span className={`text-[12px] tabular-nums ${ativa ? 'opacity-80' : 'text-texto-fraco'}`}>
                {r.noAr ? `${r.pessoas} · no ar` : r.pessoas > 0 ? `${r.pessoas} na sala` : 'vazia'}
              </span>
            </button>
          );
        })}
      </nav>

      <div className="ml-auto flex shrink-0 items-center gap-2.5">
        <button type="button" className="btn btn-icone" aria-label="Configurações" title="Configurações" onClick={onConfig}><Icone nome="ajustes" /></button>
        <button type="button" className="border-0 bg-transparent p-0" aria-label="Seu perfil" title="Seu perfil" onClick={onPerfil}>
          <Avatar pessoa={eu} tamanho={44} />
        </button>
      </div>
    </header>
  );
}

/** Square portrait that grows with its column: the photo, or the initial in Anton on the name's color. */
function Retrato({ pessoa }: { pessoa: Pick<Usuario, 'nome' | 'avatar'> }) {
  return pessoa.avatar ? (
    <img src={pessoa.avatar} alt="" decoding="async" className="aspect-[16/10] w-full object-cover" />
  ) : (
    <span aria-hidden="true" className="font-display flex aspect-[16/10] w-full items-center justify-center text-[clamp(32px,4vw,64px)] text-[#111]"
      style={{ background: corDe(pessoa.nome) }}>{inicial(pessoa.nome)}</span>
  );
}

/** One red button only: the room with the most people (or the first one) is the suggested way in. */
function salaSugerida(salas: Sala[], nela: (id: string) => number) {
  return salas.reduce<Sala | undefined>((m, s) => (!m || nela(s.id) > nela(m.id) ? s : m), undefined)?.id;
}

/**
 * Lobby as a board: every room with people is a full-height column listing who is there, so
 * the screen height is used by names, not by empty boxes. Empty rooms and the people outside
 * voice stack in one narrow column at the end.
 */
function Saguao({ salas, onSala, pessoas, eu, onCartao, onConvidar }: RoomProps) {
  const porSala = new Map<string, Pessoa[]>();
  for (const p of pessoas) if (p.online && p.sala && p.id !== eu.id) porSala.set(p.sala, [...(porSala.get(p.sala) ?? []), p]);
  const contagem = (s: Sala) => Math.max(s.pessoas, porSala.get(s.id)?.length ?? 0);
  const sugerida = salaSugerida(salas, (id) => contagem(salas.find((s) => s.id === id)!));
  const ocupadas = salas.filter((s) => contagem(s) > 0 || s.noAr);
  const vazias = salas.filter((s) => !ocupadas.includes(s));
  const fora = pessoas.filter((p) => p.id !== eu.id && !(p.online && p.sala));
  const emVoz = ocupadas.reduce((n, s) => n + contagem(s), 0);
  const podeConvidar = eu.papel === 'dono' || eu.papel === 'admin';
  const foraDaVoz = <ForaDaVoz fora={fora} onCartao={onCartao} />;
  const entrar = (s: Sala) => (
    <button type="button" className={`btn w-full ${s.id === sugerida ? 'btn-prim' : ''}`} aria-label={`Entrar na sala ${s.nome}`} onClick={() => onSala(s.id)}>
      Entrar
    </button>
  );

  return (
    <main className="flex min-h-0 flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-1">
        <h1 className="text-[56px]">Escolha uma sala</h1>
        <p className="m-0 pb-2 text-texto-fraco">
          {emVoz ? `${plural(emVoz, 'pessoa', 'pessoas')} em voz agora.` : 'Ninguém em voz agora. Entre e chame a galera.'}
        </p>
      </header>
      {salas.length === 0 ? (
        <div className="janela flex flex-1"><Vazio titulo="Nenhuma sala ainda" texto="O dono ou um admin cria as salas em Configurações > Servidor." /></div>
      ) : ocupadas.length === 0 ? (
        // Nobody in voice (the common case of a small group): blocks as tall as their content,
        // centered; the leftover space is the paper, never an empty box.
        <div className="flex min-h-0 flex-1 overflow-y-auto">
          <div className="m-auto grid w-full max-w-[1180px] grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] items-start gap-4 py-2">
            <div className="flex flex-col gap-4">
              <section className="janela flex flex-col" aria-label="Salas">
                <div className="barra">Salas<span className="ml-auto font-medium">{plural(salas.length, 'sala', 'salas')} · ninguém em voz</span></div>
                <ul className="m-0 list-none p-0">
                  {salas.map((s) => (
                    <li key={s.id} className="flex items-center gap-4 border-t border-borda px-4 py-3 first:border-t-0">
                      <span className="flex min-w-0 flex-1 flex-col">
                        <b className="font-display truncate text-[32px]">{s.nome}</b>
                        <span className="text-[14px] text-texto-fraco">Vazia. Quem entra primeiro abre a conversa.</span>
                      </span>
                      <button type="button" className={`btn btn-lg ${s.id === sugerida ? 'btn-prim' : ''}`} aria-label={`Entrar na sala ${s.nome}`} onClick={() => onSala(s.id)}>Entrar</button>
                    </li>
                  ))}
                </ul>
              </section>
              <Atalhos />
            </div>
            <div className="flex flex-col gap-4">
              <ChameGalera grande podeConvidar={podeConvidar} onConvidar={onConvidar} />
              {foraDaVoz}
            </div>
          </div>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 gap-3 overflow-x-auto pb-1"
          style={{ gridTemplateColumns: `repeat(${ocupadas.length}, minmax(240px, 1fr)) 300px` }}>
          {ocupadas.map((s) => {
            const nela = porSala.get(s.id) ?? [];
            return (
              <section key={s.id} className="janela flex min-h-0 flex-col" aria-label={`Sala ${s.nome}`}>
                <div className={`barra ${s.noAr ? 'barra-ar' : ''}`}>
                  <span className="truncate">{s.nome}</span>
                  <span className="ml-auto font-medium">{plural(contagem(s), 'pessoa', 'pessoas')}</span>
                </div>
                {s.noAr && (
                  <p className="m-0 flex items-center gap-2 border-b border-texto bg-destaque-fraco px-3 py-2 text-[14px] font-bold text-perigo">
                    <span aria-hidden="true" className="size-2 bg-destaque" />Tem tela no ar. Entre para assistir.
                  </p>
                )}
                <ul className="m-0 grid min-h-0 flex-1 list-none grid-cols-[repeat(auto-fill,minmax(max(110px,30%),1fr))] content-start gap-2 overflow-y-auto p-2.5">
                  {nela.map((p) => (
                    <li key={p.id} className={p.tema === 'noite' ? 'tema-noite' : p.tema === 'lima' ? 'tema-lima' : ''}>
                      <button type="button" className="flex w-full flex-col border border-texto bg-superficie text-left text-texto hover:bg-superficie-alta"
                        onClick={() => onCartao(p.id)} aria-label={`Ver perfil de ${p.nome}`}>
                        <Retrato pessoa={p} />
                        <span className="flex w-full min-w-0 flex-col border-t border-texto px-2.5 py-1.5 leading-tight">
                          <b className="truncate text-[15px]">{p.nome}</b>
                          <span className="truncate text-[12px] text-texto-fraco">{p.amigo ? 'amigo' : p.bio || 'na sala'}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                  {nela.length < contagem(s) && (
                    <li className="flex items-center px-1 text-[13px] text-texto-fraco">
                      {nela.length ? `e mais ${contagem(s) - nela.length}` : plural(contagem(s), 'pessoa', 'pessoas')}
                    </li>
                  )}
                </ul>
                <div className="border-t border-borda p-3">{entrar(s)}</div>
              </section>
            );
          })}

          <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
            {vazias.length > 0 && (
              <section className="janela flex flex-col" aria-label="Salas vazias">
                <div className="barra">Salas vazias<span className="ml-auto font-medium">{vazias.length}</span></div>
                <ul className="m-0 list-none p-0">
                  {vazias.map((s) => (
                    <li key={s.id} className="flex items-center gap-3 border-t border-borda px-3 py-2 first:border-t-0">
                      <b className="min-w-0 flex-1 truncate">{s.nome}</b>
                      <button type="button" className={`btn btn-sm ${s.id === sugerida ? 'btn-prim' : ''}`} aria-label={`Entrar na sala ${s.nome}`} onClick={() => onSala(s.id)}>Entrar</button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {foraDaVoz}
            <ChameGalera podeConvidar={podeConvidar} onConvidar={onConvidar} />
          </div>
        </div>
      )}
    </main>
  );
}

/** People outside voice, as tall as the list (online first). */
function ForaDaVoz({ fora, onCartao }: { fora: Pessoa[]; onCartao(id: string): void }) {
  return (
    <section className="janela flex flex-col" aria-label="Fora da voz">
      <div className="barra">Fora da voz<span className="ml-auto font-medium">{fora.filter((p) => p.online).length} online</span></div>
      {fora.length === 0 ? (
        <p className="m-0 p-3 text-[14px] text-texto-fraco">Todo mundo do servidor está numa sala.</p>
      ) : (
        <ul className="m-0 list-none p-0">
          {[...fora].sort((a, b) => Number(b.online) - Number(a.online)).map((p) => (
            <li key={p.id}>
              <button type="button" className="flex min-h-11 w-full items-center gap-2.5 border-0 bg-transparent px-3 py-1 text-left hover:bg-superficie-alta"
                onClick={() => onCartao(p.id)} aria-label={`Ver perfil de ${p.nome}`}>
                <Avatar pessoa={p} tamanho={28} />
                <span className={`min-w-0 flex-1 truncate text-[14px] ${p.online ? '' : 'text-texto-fraco'}`}>{p.nome}</span>
                <span className="text-[12px] text-texto-fraco">{p.online ? 'online' : 'offline'}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Invite call to action. Only the owner and admins can create invites (the porteiro answers 403 otherwise). */
function ChameGalera({ grande = false, podeConvidar, onConvidar }: { grande?: boolean; podeConvidar: boolean; onConvidar(): Promise<void> }) {
  const [estado, setEstado] = useState<'' | 'gerando' | 'copiado' | { erro: string }>('');
  async function convidar() {
    setEstado('gerando');
    try {
      await onConvidar();
      setEstado('copiado');
    } catch (e) {
      setEstado({ erro: e instanceof Error ? e.message : String(e) });
    }
  }
  return (
    <section className="janela flex flex-col" aria-label="Chame a galera">
      <div className="barra barra-lima">Convite<span className="ml-auto font-medium">7 dias · 1 uso</span></div>
      <div className={`flex flex-col gap-3 ${grande ? 'p-5' : 'p-3'}`}>
        <b className={`font-display ${grande ? 'text-[48px]' : 'text-[24px]'}`}>Chame a galera</b>
        {podeConvidar ? (
          <>
            <p className="m-0 text-[14px] text-texto-fraco">
              {grande ? 'O link vai para a área de transferência. Mande no grupo: quem abrir entra direto neste servidor.' : 'Gere um link e mande no grupo.'}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className={`btn ${grande ? 'btn-lg' : ''}`} disabled={estado === 'gerando'} onClick={() => void convidar()}>
                <Icone nome="link" />{estado === 'gerando' ? 'Gerando…' : 'Convidar'}
              </button>
              {estado === 'copiado' && <span role="status" className="text-[14px] text-texto-fraco">Link copiado.</span>}
            </div>
            {typeof estado === 'object' && (
              <Faixa acoes={[{ rotulo: 'Tentar de novo', onClick: () => void convidar() }]} onFechar={() => setEstado('')}>
                Não deu para gerar o convite. {estado.erro}
              </Faixa>
            )}
          </>
        ) : (
          <p className="m-0 text-[14px] text-texto-fraco">Só o dono ou um admin gera convites. Peça o link a eles e mande para quem você quer chamar.</p>
        )}
      </div>
    </section>
  );
}
