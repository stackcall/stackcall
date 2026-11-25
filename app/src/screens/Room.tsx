import { useMemo, useState } from 'react';
import { FaixaCutucada } from '../components/FaixaCutucada';
import { Topo } from '../components/Topo';
import type { Cutucada } from '../lib/cutucar';
import { esperaCutucar, marcarCutucada, somSilenciado } from '../lib/cutucadas';
import { abrir } from '../lib/paleta';
import type { Pessoa, Sala, Servidor, Usuario } from '../lib/servidor';
import { useDemoRoom } from '../room/demo';
import { useLiveRoom } from '../room/useLiveRoom';
import { useReconexao } from '../room/reconexao';
import { RoomView } from './sala/Sala';

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
  /** Poke received (lib/cutucar.ts); the strip stays until closed or until entering that room. */
  cutucada?: Cutucada | null;
  onFecharCutucada?(): void;
};

export type ComSala = Omit<RoomProps, 'sala'> & { sala: Sala };

/** Top bar (shared with the lobby), the poke strip when there is one, then the live room. */
export function RoomScreen(props: RoomProps) {
  const ativa = props.salas.find((s) => s.id === props.sala);
  const { cutucada, onFecharCutucada } = props;
  const deVolta = async (para: string) => {
    if (esperaCutucar(para) > 0) return onFecharCutucada?.();
    await props.servidor.cutucar(para, '').then(() => {
      marcarCutucada(para);
      onFecharCutucada?.();
    }, () => undefined);
  };
  return (
    <div className={`grid h-full gap-4 overflow-hidden px-5 pt-4 pb-5 ${cutucada ? 'grid-rows-[auto_auto_minmax(0,1fr)]' : 'grid-rows-[auto_minmax(0,1fr)]'}`}>
      <Topo nomeServidor={props.nomeServidor} salas={props.salas} sala={props.sala} pessoas={props.pessoas} eu={props.eu}
        onSala={props.onSala} onConfig={props.onConfig} onPerfil={props.onPerfil} onBusca={() => abrir('paleta')} onClipes={() => abrir('clipes')} />
      {cutucada && onFecharCutucada && (
        <FaixaCutucada cutucada={cutucada} silenciado={somSilenciado()} onFechar={onFecharCutucada}
          onEntrar={cutucada.salaId && cutucada.salaId !== props.sala ? () => { props.onSala(cutucada.salaId); onFecharCutucada(); } : undefined}
          onCutucarDeVolta={cutucada.deId ? () => void deVolta(cutucada.deId!) : undefined} />
      )}
      {ativa && (props.demo ? <DemoRoom key={ativa.id} {...props} sala={ativa} /> : <LiveRoom key={ativa.id} {...props} sala={ativa} />)}
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
