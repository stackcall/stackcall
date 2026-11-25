import { Avatar } from './Avatar';
import { Icone } from './Icone';
import type { Cutucada } from '../lib/cutucar';

/**
 * Strip under the top bar for a poke received (prototype v05, #saguao). Stays until closed or
 * until the person enters the room. Shared by the lobby and the room.
 */
export function FaixaCutucada({ cutucada, silenciado, onEntrar, onCutucarDeVolta, onFechar }: {
  cutucada: Cutucada;
  silenciado: boolean;
  onEntrar?(): void;
  onCutucarDeVolta?(): void;
  onFechar(): void;
}) {
  const { de, recado, salaNome } = cutucada;
  return (
    <div role="alert" aria-label={`${de} te cutucou`} className="flex min-h-[64px] shrink-0 items-stretch gap-4 border-2 border-destaque bg-superficie pr-2">
      <span aria-hidden="true" className="flex w-[52px] shrink-0 items-center justify-center bg-destaque text-sobre-destaque"><Icone nome="voz" tamanho={24} /></span>
      <span className="flex items-center"><Avatar pessoa={{ nome: de, avatar: null }} tamanho={40} /></span>
      <span className="flex min-w-0 flex-1 flex-col justify-center py-2">
        <span className="truncate text-[17px]"><b>{de} te cutucou{recado.trim() ? ':' : ''}</b>{recado.trim() && <> “{recado.trim()}”</>}</span>
        <span className="truncate text-[13px] text-texto-fraco">
          {[salaNome && `sala ${salaNome}`, 'agora', silenciado ? 'lido em voz alta com o seu som desligado' : 'lido em voz alta'].filter(Boolean).join(' · ')}
        </span>
      </span>
      <span className="flex items-center gap-2">
        {onEntrar && salaNome && <button type="button" className="btn btn-prim" onClick={onEntrar}><Icone nome="enviar" />Entrar na sala {salaNome}</button>}
        {onCutucarDeVolta && <button type="button" className="btn" onClick={onCutucarDeVolta}>Cutucar de volta</button>}
        <button type="button" className="btn btn-icone" aria-label="Fechar cutucada" title="Fechar" onClick={onFechar}><Icone nome="fechar" /></button>
      </span>
    </div>
  );
}
