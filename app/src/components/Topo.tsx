import { Avatar } from './Avatar';
import { Icone } from './Icone';
import type { Pessoa, Sala, Usuario } from '../lib/servidor';

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/**
 * Top bar of the prototype (brand and server, room tabs, search, clips, settings, you).
 * Same markup as the room's own bar in screens/Room.tsx; the lobby uses this copy so the room
 * file stays with the room thread. The search and clips buttons appear when their handlers exist.
 */
export function Topo({ nomeServidor, salas, sala, pessoas, eu, onSala, onConfig, onPerfil, onBusca, onClipes }: {
  nomeServidor: string; salas: Sala[]; sala: string | null; pessoas: Pessoa[]; eu: Usuario;
  onSala(id: string): void; onConfig(): void; onPerfil(): void; onBusca?(): void; onClipes?(): void;
}) {
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

      {onBusca ? (
        <button type="button" onClick={onBusca} aria-keyshortcuts="Control+K" className="janela flex h-[52px] min-w-0 flex-1 items-center gap-2.5 px-3 text-left text-texto-fraco hover:border-destaque">
          <Icone nome="busca" /><span className="truncate">Buscar sala, pessoa, ação ou ajuste</span>
          <kbd className="ml-auto hidden border border-borda px-1.5 font-mono text-[11px] min-[1280px]:inline">Ctrl+K</kbd>
        </button>
      ) : <span className="flex-1" />}

      <div className="flex shrink-0 items-center gap-2.5">
        {onClipes && <button type="button" className="btn btn-icone" aria-label="Clipes" title="Clipes" onClick={onClipes}><Icone nome="filme" /></button>}
        <button type="button" className="btn btn-icone" aria-label="Configurações" title="Configurações" onClick={onConfig}><Icone nome="ajustes" /></button>
        <button type="button" className="border-0 bg-transparent p-0" aria-label="Seu perfil" title="Seu perfil" onClick={onPerfil}>
          <Avatar pessoa={eu} tamanho={44} />
        </button>
      </div>
    </header>
  );
}
