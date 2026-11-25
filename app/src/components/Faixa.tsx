import type { ReactNode } from 'react';
import { Icone } from './Icone';

export type Acao = { rotulo: string; onClick(): void; principal?: boolean };

/**
 * Notice strip with an exit: errors get "Tentar de novo", questions get their answers.
 * `erro` is an alert (read at once); `aviso` is a polite status.
 */
export function Faixa({ tipo = 'erro', children, acoes = [], onFechar, className = '' }: {
  tipo?: 'erro' | 'aviso'; children: ReactNode; acoes?: Acao[]; onFechar?(): void; className?: string;
}) {
  const erro = tipo === 'erro';
  return (
    <div role={erro ? 'alert' : 'status'}
      className={`flex min-h-11 items-center gap-3 border py-1 pr-1 pl-3 text-[14px] ${erro ? 'faixa-erro' : 'border-texto bg-superficie-alta text-texto'} ${className}`}>
      <span aria-hidden="true" className="font-display shrink-0 text-[18px] leading-none">{erro ? '!' : 'i'}</span>
      <span className="min-w-0 flex-1">{children}</span>
      {acoes.map((a) => (
        <button key={a.rotulo} type="button" className={`btn btn-sm ${a.principal ? 'btn-prim' : ''}`} onClick={a.onClick}>{a.rotulo}</button>
      ))}
      {onFechar && (
        <button type="button" className="btn btn-fant btn-icone btn-sm" aria-label="Fechar aviso" title="Fechar" onClick={onFechar}>
          <Icone nome="fechar" tamanho={16} />
        </button>
      )}
    </div>
  );
}
