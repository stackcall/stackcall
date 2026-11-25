import { useEffect, useRef, useState } from 'react';
import type { Pessoa, Usuario } from '../lib/servidor';
import { Avatar } from './Avatar';
import { Icone } from './Icone';

type Props = {
  pessoa: Usuario | Pessoa;
  souEu?: boolean;
  podeRemover?: boolean;
  onAmigo?(sim: boolean): void;
  onRemover?(): void;
  onEditar?(): void;
  onFechar?(): void;
  comoDialogo?: boolean;
};

export function CartaoPerfil({ pessoa, souEu = false, podeRemover = false, onAmigo, onRemover, onEditar, onFechar, comoDialogo = true }: Props) {
  const [confirma, setConfirma] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (comoDialogo) ref.current?.focus();
  }, [comoDialogo]);

  const tema = pessoa.tema === 'noite' ? 'tema-noite' : pessoa.tema === 'lima' ? 'tema-lima' : '';
  const cor = pessoa.cor ?? 'var(--color-destaque)';
  const online = 'online' in pessoa ? pessoa.online : null;
  const amigo = 'amigo' in pessoa ? pessoa.amigo : null;

  const cartao = (
    <div className={`janela w-[340px] max-w-full text-texto ${tema}`}>
      <div className="relative aspect-[3/1] border-b border-texto" style={{ background: cor }}>
        {pessoa.banner && <img src={pessoa.banner} alt="" className="h-full w-full object-cover" />}
        {comoDialogo && (
          <button type="button" aria-label="Fechar" onClick={onFechar} className="btn btn-icone absolute right-2 top-2">
            <Icone nome="fechar" />
          </button>
        )}
      </div>
      <div className="px-4 pb-4">
        <Avatar pessoa={pessoa} tamanho={88} className="relative -mt-11 bg-superficie" />
        <h2 className="mt-3 break-words text-[32px]">{pessoa.nome}</h2>
        <p className="rotulo mt-1 flex items-center gap-2">
          <span>{pessoa.papel}</span>
          {online !== null && (
            <>
              <span aria-hidden="true">·</span>
              <span aria-hidden="true" className="inline-block h-2 w-2 border border-texto" style={{ background: online ? 'var(--color-lima)' : 'transparent' }} />
              <span>{online ? 'online' : 'offline'}</span>
            </>
          )}
        </p>
        <p className={`mt-3 whitespace-pre-wrap break-words text-sm ${pessoa.bio ? '' : 'text-texto-fraco'}`}>{pessoa.bio || 'Sem bio.'}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {souEu ? (
            <button type="button" className="btn" onClick={onEditar}>Editar perfil</button>
          ) : (
            amigo !== null && (
              <button type="button" className="btn" onClick={() => onAmigo?.(!amigo)}>{amigo ? 'Remover amigo' : 'Adicionar amigo'}</button>
            )
          )}
          {podeRemover && !souEu &&
            (confirma ? (
              <button type="button" className="btn border-perigo text-perigo" onClick={onRemover}>Confirmar remoção</button>
            ) : (
              <button type="button" className="btn btn-fant" onClick={() => setConfirma(true)}>Remover do servidor</button>
            ))}
        </div>
      </div>
    </div>
  );

  if (!comoDialogo) return cartao;
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40" onClick={(e) => e.target === e.currentTarget && onFechar?.()}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={`Perfil de ${pessoa.nome}`}
        tabIndex={-1}
        onKeyDown={(e) => e.key === 'Escape' && onFechar?.()}
        className="outline-none"
      >
        {cartao}
      </div>
    </div>
  );
}
