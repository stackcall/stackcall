import { useState, type FormEvent } from 'react';
import { Icone } from '../../components/Icone';
import { esperaCutucar, fraseCutucada, lembrarUltimo, LIMITE_RECADO, marcarCutucada, SUGESTOES } from '../../lib/cutucadas';
import { ApiError, type Servidor } from '../../lib/servidor';
import { Popover, type Ancora } from './Popover';

/**
 * Small poke field over the person's channel: message up to 80 characters with a counter, three quick
 * suggestions, the exact sentence the person will hear and the 30 s limit. Enter sends; Esc closes.
 */
export function Cutucar({ ancora, alvo, eu, servidor, somDesligado, onFechar, onEnviada }: {
  ancora: Ancora; alvo: { id: string; nome: string }; eu: string; servidor: Servidor; somDesligado: boolean;
  onFechar(): void; onEnviada(): void;
}) {
  const [recado, setRecado] = useState('');
  const [estado, setEstado] = useState<'' | 'enviando' | { erro: string }>('');
  const espera = esperaCutucar(alvo.id);

  async function enviar(e?: FormEvent) {
    e?.preventDefault();
    if (estado === 'enviando' || espera > 0) return;
    if (!servidor.cutucar) return setEstado({ erro: 'Este servidor ainda não aceita cutucadas.' });
    setEstado('enviando');
    try {
      await servidor.cutucar(alvo.id, recado.trim());
      marcarCutucada(alvo.id);
      lembrarUltimo(alvo.id);
      onEnviada();
      onFechar();
    } catch (x) {
      if (x instanceof ApiError && x.status === 429) marcarCutucada(alvo.id);
      setEstado({ erro: x instanceof ApiError && x.status === 403 ? `${alvo.nome} não recebe cutucadas agora.` : x instanceof Error ? x.message : String(x) });
    }
  }

  return (
    <Popover ancora={ancora} onFechar={onFechar} rotulo={`Cutucar ${alvo.nome}`} className="flex w-[416px] flex-col">
      <form onSubmit={(e) => void enviar(e)}>
        <div className="barra">
          <span className="truncate">Cutucar {alvo.nome}</span>
          {somDesligado && <span className="ml-auto font-medium">som desligado · ouve mesmo assim</span>}
        </div>
        <div className="flex flex-col gap-2.5 p-3">
          <label className="flex h-11 items-center gap-2 border border-destaque px-3 focus-within:outline-2 focus-within:outline-destaque">
            <span className="sr-only">Recado</span>
            <input autoFocus className="min-w-0 flex-1 border-0 bg-transparent text-[15px] text-texto outline-none" value={recado}
              maxLength={LIMITE_RECADO} placeholder="Recado (opcional)" onChange={(e) => setRecado(e.target.value)} />
            <span className="font-mono text-[12px] text-texto-fraco tabular-nums" aria-label={`${recado.length} de ${LIMITE_RECADO} caracteres`}>
              {recado.length}/{LIMITE_RECADO}
            </span>
          </label>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Recados rápidos">
            {SUGESTOES.map((s) => (
              <button key={s} type="button" aria-pressed={recado === s} onClick={() => setRecado(s)}
                className={`btn btn-sm font-medium ${recado === s ? 'bg-texto text-superficie' : ''}`}>{s}</button>
            ))}
          </div>
          <p className="m-0 flex items-start gap-2 text-[13px] text-texto-fraco">
            <Icone nome="volume" tamanho={16} />
            <span>{alvo.nome} vai ouvir: <b className="text-texto">“{fraseCutucada(eu, recado)}”</b></span>
          </p>
          {typeof estado === 'object' && <p role="alert" className="m-0 text-[13px] font-bold text-perigo">{estado.erro}</p>}
        </div>
        <div className="flex items-center gap-2 border-t border-borda p-3">
          <span className="rotulo mr-auto text-[11px] leading-tight">
            {espera > 0 ? `Pode cutucar de novo em ${espera} s` : 'Uma cutucada a cada 30 s para a mesma pessoa'}
          </span>
          <button type="button" className="btn btn-sm" onClick={onFechar}>Cancelar</button>
          <button type="submit" className="btn btn-sm btn-prim" disabled={estado === 'enviando' || espera > 0}>
            <Icone nome="cutuca" tamanho={16} />{estado === 'enviando' ? 'Cutucando…' : 'Cutucar'}
          </button>
        </div>
      </form>
    </Popover>
  );
}
