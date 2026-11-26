import { useState, type FormEvent } from 'react';
import { Avatar } from './Avatar';
import { Icone } from './Icone';
import { ROTULO_RESPOSTA, resumoRespostas } from '../lib/bora';
import type { Bora, Pessoa, RespostaBora, Sala } from '../lib/servidor';

/**
 * Open "Bora?" calls under the top bar: one line each, answer with one tap. My own call shows
 * who answered and lets me close it.
 */
export function FaixaBora({ boras, euId, pessoas, salas, salaAtual, onResponder, onEncerrar, onEntrar }: {
  boras: Bora[]; euId: string; pessoas: Pessoa[]; salas: Sala[]; salaAtual: string | null;
  onResponder(id: string, r: RespostaBora): void; onEncerrar(id: string): void; onEntrar(salaId: string): void;
}) {
  if (boras.length === 0) return null;
  const nome = (id: string) => (id === euId ? 'Você' : pessoas.find((p) => p.id === id)?.nome ?? 'Alguém');
  return (
    <div className="flex shrink-0 flex-col gap-2" aria-label="Chamados para jogar">
      {boras.slice(0, 3).map((b) => {
        const minha = b.respostas.find((r) => r.usuario === euId)?.resposta;
        const sala = salas.find((s) => s.id === b.sala);
        const meu = b.autor === euId;
        return (
          <div key={b.id} role="status" className="flex min-h-[56px] flex-wrap items-center gap-x-3 gap-y-2 border-2 border-lima bg-superficie py-1.5 pr-2 pl-2">
            <Avatar pessoa={pessoas.find((p) => p.id === b.autor) ?? { nome: nome(b.autor), avatar: null }} tamanho={36} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[16px]">
                <b>{meu ? 'Você chamou: bora?' : `${nome(b.autor)}: bora?`}</b>
                {b.recado && <> “{b.recado}”</>}
              </span>
              <span className="truncate text-[13px] text-texto-fraco">
                {[sala && `sala ${sala.nome}`, resumoRespostas(b)].filter(Boolean).join(' · ')}
              </span>
            </span>
            <span className="flex flex-wrap items-center gap-1.5 max-md:w-full max-md:[&>button]:flex-1">
              {sala && sala.id !== salaAtual && (minha === 'dentro' || meu) && (
                <button type="button" className="btn btn-prim btn-sm" onClick={() => onEntrar(sala.id)}>Entrar na sala {sala.nome}</button>
              )}
              {!meu && (Object.keys(ROTULO_RESPOSTA) as RespostaBora[]).map((r) => (
                <button key={r} type="button" aria-pressed={minha === r}
                  className={`btn btn-sm ${minha === r ? 'bg-texto text-superficie' : ''}`} onClick={() => onResponder(b.id, r)}>
                  {ROTULO_RESPOSTA[r]}
                </button>
              ))}
              {meu && <button type="button" className="btn btn-sm" onClick={() => onEncerrar(b.id)}>Encerrar</button>}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Dialog to call the group: which room (optional) and a short note. */
export function NovoBora({ salas, salaPadrao, onEnviar, onFechar }: {
  salas: Sala[]; salaPadrao: string | null; onEnviar(o: { sala?: string; recado?: string }): Promise<void>; onFechar(): void;
}) {
  const [sala, setSala] = useState(salaPadrao ?? '');
  const [recado, setRecado] = useState('');
  const [erro, setErro] = useState<string>();
  const [enviando, setEnviando] = useState(false);
  async function enviar(e: FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setErro(undefined);
    try {
      await onEnviar({ sala: sala || undefined, recado: recado.trim() || undefined });
      onFechar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
      setEnviando(false);
    }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-3 min-[520px]:items-center" onClick={onFechar}>
      <form role="dialog" aria-modal="true" aria-labelledby="bora-titulo" onSubmit={enviar} onClick={(e) => e.stopPropagation()}
        className="janela flex w-full max-w-[420px] flex-col">
        <div className="barra barra-lima" id="bora-titulo">Bora?<span className="ml-auto font-medium">avisa a galera</span></div>
        <div className="flex flex-col gap-3 p-4">
          <p className="m-0 text-[14px] text-texto-fraco">Todo mundo recebe o chamado no app e no celular, e responde com um toque. Vale por 2 horas.</p>
          <label className="flex flex-col gap-1.5">
            <span className="font-bold">Sala</span>
            <select className="campo" value={sala} onChange={(e) => setSala(e.target.value)}>
              <option value="">Qualquer sala</option>
              {salas.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="font-bold">Recado (opcional)</span>
            <input className="campo" value={recado} maxLength={80} onChange={(e) => setRecado(e.target.value)} placeholder="premier agora, falta 1" autoFocus />
          </label>
          {erro && <p role="alert" className="m-0 text-perigo">{erro}</p>}
          <div className="flex gap-2">
            <button type="button" className="btn" onClick={onFechar}>Cancelar</button>
            <button type="submit" className="btn btn-prim flex-1" disabled={enviando}><Icone nome="voz" />{enviando ? 'Chamando…' : 'Chamar a galera'}</button>
          </div>
        </div>
      </form>
    </div>
  );
}
