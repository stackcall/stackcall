import { useEffect, useRef, useState } from 'react';
import { useTema } from '../lib/tema';
import { Cabecalho, Linha, Segmento } from '../components/Controles';
import { TesteRede } from './config/TesteRede';
import { lerAtalhos } from '../lib/atalhos';
import { aoMudarVoz, capturaDe, lerVoz, salvarVoz, type Voz } from '../lib/voz';

type Aparelho = { id: string; nome: string };

/** Lists microphones and outputs. Labels only come after a microphone permission (the test grants it). */
async function listarAparelhos() {
  const md = navigator.mediaDevices;
  if (!md?.enumerateDevices) return null;
  const todos = await md.enumerateDevices().catch(() => []);
  const de = (tipo: MediaDeviceKind): Aparelho[] => todos
    .filter((d) => d.kind === tipo && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications')
    .map((d, i) => ({ id: d.deviceId, nome: d.label || `${tipo === 'audioinput' ? 'Microfone' : 'Saída'} ${i + 1}` }));
  return { entradas: de('audioinput'), saidas: de('audiooutput') };
}

/** Settings > Você > Voz e rede: voice mode, devices, voice processing and the network test. */
export function SecaoPreferencias({ servidorUrl, destaque }: { servidorUrl: string | null; destaque?: string }) {
  const [voz, setVoz] = useState<Voz>(lerVoz);
  // The room can turn the strong suppression off by itself when it fails: follow it.
  useEffect(() => aoMudarVoz(setVoz), []);
  const [aparelhos, setAparelhos] = useState<Awaited<ReturnType<typeof listarAparelhos>> | undefined>();
  const mudar = (m: Partial<Voz>) => setVoz(salvarVoz(m));
  const atualizar = () => void listarAparelhos().then(setAparelhos);

  useEffect(() => {
    atualizar();
    const md = navigator.mediaDevices;
    md?.addEventListener?.('devicechange', atualizar);
    return () => md?.removeEventListener?.('devicechange', atualizar);
  }, []);

  return (
    <>
      <Cabecalho rotulo="Você · vale para este PC" titulo="Voz e rede">Muda na hora, sem sair da sala.</Cabecalho>

      <section data-ajuste="voz-modo" className={`janela flex flex-col ${destaque === 'voz-modo' ? 'outline-2 outline-offset-2 outline-destaque' : ''}`} aria-label="Modo de voz">
        <div className="barra">Modo de voz</div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 p-4">
          <div className="abas" role="group" aria-label="Modo de voz">
            <button type="button" aria-pressed={voz.modo === 'voz'} onClick={() => mudar({ modo: 'voz' })}>Detecção de voz</button>
            <button type="button" aria-pressed={voz.modo === 'ptt'} onClick={() => mudar({ modo: 'ptt' })}>Apertar para falar</button>
          </div>
          {voz.modo === 'ptt' ? (
            <>
              <label className="flex items-center gap-3 text-[14px]">
                <span className="font-bold">Soltura</span>
                <input type="range" min={0} max={1000} step={50} value={voz.soltura} className="h-11 w-40"
                  onChange={(e) => mudar({ soltura: Number(e.target.value) })} aria-valuetext={`${voz.soltura} milissegundos`} />
                <span className="w-16 font-mono tabular-nums">{voz.soltura} ms</span>
              </label>
              <span className="basis-full text-[14px] text-texto-fraco">
                O microfone só abre enquanto você segura a tecla, e fecha {voz.soltura} ms depois de soltar.{' '}
                {lerAtalhos().teclas.falar ? `Tecla: ${lerAtalhos().teclas.falar}.` : 'Grave a tecla em Configurações > Atalhos.'}
              </span>
            </>
          ) : (
            <span className="text-[14px] text-texto-fraco">O microfone abre sozinho quando você fala. É o padrão.</span>
          )}
        </div>
      </section>

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4 max-[1180px]:grid-cols-1">
        <section data-ajuste="voz-aparelhos" className={`janela flex flex-col ${destaque === 'voz-aparelhos' ? 'outline-2 outline-offset-2 outline-destaque' : ''}`}>
          <div className="barra">Aparelhos</div>
          <div className="flex flex-col gap-4 p-4">
            {aparelhos === null ? (
              <p className="m-0 text-texto-fraco">Este ambiente não lista aparelhos de áudio. No app instalado eles aparecem aqui.</p>
            ) : (
              <>
                <Escolha id="voz-entrada" rotulo="Microfone" valor={voz.entrada} lista={aparelhos?.entradas} onMudar={(entrada) => mudar({ entrada })} />
                <Escolha id="voz-saida" rotulo="Saída de som" valor={voz.saida} lista={aparelhos?.saidas} onMudar={(saida) => mudar({ saida })} />
                {aparelhos && aparelhos.entradas.every((a) => /^Microfone \d+$/.test(a.nome)) && (
                  <p className="m-0 text-[13px] text-texto-fraco">Os nomes aparecem depois do primeiro teste do microfone.</p>
                )}
              </>
            )}
            <TesteMicrofone voz={voz} onPermissao={atualizar} />
          </div>
        </section>

        <section data-ajuste="voz-ruido voz-eco voz-ganho" className={`janela flex flex-col ${destaque && ['voz-ruido', 'voz-eco', 'voz-ganho'].includes(destaque) ? 'outline-2 outline-offset-2 outline-destaque' : ''}`}>
          <div className="barra">Tratamento da voz</div>
          <div className="flex flex-col p-4">
            <Opcao id="voz-ruido" rotulo="Supressão de ruído" ajuda={voz.forte
              ? 'Fica parada enquanto a supressão forte está ligada, para não cortar a voz duas vezes.'
              : 'Tira ruído constante (ventoinha, ar-condicionado). Teclado alto ainda passa.'}
              ligado={voz.ruido} onMudar={(ruido) => mudar({ ruido })} />
            <Opcao id="voz-forte" rotulo="Supressão forte (teclado e cliques)" ajuda="Filtro RNNoise: tira teclado e mouse. Gasta um pouco de CPU e pode cortar o fim de palavras. Só carrega quando você liga."
              ligado={voz.forte} onMudar={(forte) => mudar({ forte })} />
            <Opcao id="voz-eco" rotulo="Cancelamento de eco" ajuda="Precisa se o som sai da caixa. Com fone de ouvido, pode desligar."
              ligado={voz.eco} onMudar={(eco) => mudar({ eco })} />
            <Opcao id="voz-ganho" rotulo="Controle automático de ganho" ajuda="Iguala o volume da sua voz. Desligue se ele subir e descer sozinho."
              ligado={voz.ganho} onMudar={(ganho) => mudar({ ganho })} />
          </div>
        </section>
      </div>

      <TesteRede servidorUrl={servidorUrl} destaque={destaque === 'voz-rede'} />
    </>
  );
}

/** Settings > Você > Aparência. */
export function SecaoAparencia({ destaque }: { destaque?: string }) {
  const [tema, setTema] = useTema();
  return (
    <>
      <Cabecalho rotulo="Você · vale para este PC" titulo="Aparência" />
      <Linha ajuste="tema" titulo="Tema" descricao="O claro é o padrão. A barra de título do Windows acompanha." destaque={destaque === 'tema'}>
        <Segmento rotulo="Tema" valor={tema} opcoes={[['claro', 'Claro'], ['escuro', 'Escuro']]} onMudar={setTema} />
      </Linha>
    </>
  );
}

function Escolha({ id, rotulo, valor, lista, onMudar }: { id: string; rotulo: string; valor: string; lista?: Aparelho[]; onMudar(v: string): void }) {
  const sumiu = valor && lista && !lista.some((a) => a.id === valor);
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="font-bold">{rotulo}</label>
      <select id={id} className="campo" value={sumiu ? '' : valor} onChange={(e) => onMudar(e.target.value)} disabled={!lista}>
        <option value="">Padrão do Windows</option>
        {lista?.map((a) => <option key={a.id} value={a.id}>{a.nome}</option>)}
      </select>
      {sumiu && <span className="text-[13px] text-texto-fraco">O aparelho escolhido não está conectado. Usando o padrão do Windows.</span>}
    </div>
  );
}

function Opcao({ id, rotulo, ajuda, ligado, onMudar }: { id: string; rotulo: string; ajuda: string; ligado: boolean; onMudar(v: boolean): void }) {
  return (
    <div className="flex min-h-14 items-center gap-4 border-t border-borda py-2 first:border-t-0">
      <span className="flex flex-1 flex-col gap-0.5">
        <span id={`${id}-rotulo`} className="font-bold">{rotulo}</span>
        <span id={`${id}-ajuda`} className="text-[13px] text-texto-fraco">{ajuda}</span>
      </span>
      <button id={id} type="button" role="switch" aria-checked={ligado} aria-labelledby={`${id}-rotulo`} aria-describedby={`${id}-ajuda`} onClick={() => onMudar(!ligado)}
        className={`btn btn-sm w-[88px] ${ligado ? 'bg-texto text-superficie' : ''}`}>{ligado ? 'Ligado' : 'Desligado'}</button>
    </div>
  );
}

/** Opens the microphone with the chosen options and draws its level; closes everything on stop. */
function TesteMicrofone({ voz, onPermissao }: { voz: Voz; onPermissao(): void }) {
  const [estado, setEstado] = useState<'parado' | 'abrindo' | 'ouvindo' | 'erro'>('parado');
  const barra = useRef<HTMLSpanElement>(null);
  const fim = useRef<(() => void) | null>(null);
  const parar = () => {
    fim.current?.();
    fim.current = null;
    setEstado('parado');
  };
  useEffect(() => () => fim.current?.(), []);
  // Options changed during the test: reopen with the new ones.
  useEffect(() => {
    if (estado === 'ouvindo') void comecar();
  }, [voz.entrada, voz.eco, voz.ganho, voz.ruido]);

  async function comecar() {
    fim.current?.();
    setEstado('abrindo');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: capturaDe(voz) });
      const ctx = new AudioContext();
      const analisador = ctx.createAnalyser();
      analisador.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analisador);
      const dados = new Uint8Array(analisador.fftSize);
      let id = requestAnimationFrame(function quadro() {
        analisador.getByteTimeDomainData(dados);
        let pico = 0;
        for (const d of dados) pico = Math.max(pico, Math.abs(d - 128));
        if (barra.current) barra.current.style.transform = `scaleX(${Math.min(1, (pico / 128) * 1.6)})`;
        id = requestAnimationFrame(quadro);
      });
      fim.current = () => {
        cancelAnimationFrame(id);
        stream.getTracks().forEach((t) => t.stop());
        void ctx.close();
      };
      setEstado('ouvindo');
      onPermissao();
    } catch {
      setEstado('erro');
    }
  }

  return (
    <div className="flex flex-col gap-2 border-t border-borda pt-4">
      <span className="font-bold">Teste do microfone</span>
      <div className="flex items-center gap-3">
        <button type="button" className="btn" disabled={estado === 'abrindo'} onClick={() => (estado === 'ouvindo' ? parar() : void comecar())}>
          {estado === 'ouvindo' ? 'Parar teste' : estado === 'abrindo' ? 'Abrindo…' : 'Testar microfone'}
        </button>
        <span className="relative h-3 flex-1 border border-texto bg-superficie-alta" role="meter" aria-label="Nível do microfone"
          aria-valuemin={0} aria-valuemax={100} aria-valuetext={estado === 'ouvindo' ? 'ouvindo' : 'parado'}>
          <span ref={barra} className="absolute inset-0 origin-left scale-x-0 bg-lima" />
        </span>
      </div>
      <span role="status" className={`text-[13px] ${estado === 'erro' ? 'text-perigo' : 'text-texto-fraco'}`}>
        {estado === 'erro' ? 'Não deu para abrir o microfone. Confira a permissão do Windows em Privacidade > Microfone.'
          : estado === 'ouvindo' ? 'Fale normalmente: a barra deve encher até a metade.' : 'Fale depois de tocar. Nada é gravado nem enviado.'}
      </span>
    </div>
  );
}
