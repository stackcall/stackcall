import { useEffect, useState } from 'react';
import { encode } from 'uqr';
import { Cabecalho } from '../../components/Controles';
import { naWeb } from '../../lib/ambiente';
import type { Servidor } from '../../lib/servidor';

/**
 * "Celular": on the PC, a QR code that logs the phone in (one use, 10 minutes); on the phone,
 * the notices for Bora? and pokes (Web Push).
 */
export function PaginaCelular({ servidor }: { servidor: Servidor | null }) {
  return (
    <>
      <Cabecalho rotulo="Você · celular" titulo="Celular">
        O mesmo Stackcall no celular: entre na call, fale, assista às telas e responda o Bora?. Abre no navegador, sem instalar nada da loja.
      </Cabecalho>
      {servidor && (naWeb() ? <AvisosNoCelular servidor={servidor} /> : <EntrarNoCelular servidor={servidor} />)}
    </>
  );
}

/** Web app address that logs in with a device code, from the porteiro's stackcall:// link. */
export function enderecoCelular(deepLink: string) {
  const url = new URL(deepLink);
  const servidor = url.searchParams.get('servidor');
  const codigo = url.searchParams.get('codigo');
  if (!servidor || !codigo) return null;
  return `${servidor.replace(/\/+$/, '')}/app/#entrar=${encodeURIComponent(codigo)}`;
}

function Qr({ texto }: { texto: string }) {
  const { data, size } = encode(texto, { ecc: 'M', border: 2 });
  const caminho = data.flatMap((linha, y) => linha.map((preto, x) => (preto ? `M${x} ${y}h1v1h-1z` : ''))).join('');
  return (
    <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label="QR code para entrar no celular" className="size-[220px] bg-white p-1" shapeRendering="crispEdges">
      <path d={caminho} fill="#111" />
    </svg>
  );
}

function EntrarNoCelular({ servidor }: { servidor: Servidor }) {
  const [link, setLink] = useState<string | null>(null);
  const [erro, setErro] = useState<string>();
  const [expira, setExpira] = useState(0);
  const [agora, setAgora] = useState(Date.now());
  useEffect(() => {
    if (!link) return;
    const t = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(t);
  }, [link]);
  const restante = Math.max(0, Math.round((expira - agora) / 1000));
  async function gerar() {
    setErro(undefined);
    try {
      const endereco = enderecoCelular(await servidor.linkAparelho());
      if (!endereco) throw new Error('Resposta inesperada do servidor.');
      setLink(endereco);
      setExpira(Date.now() + 10 * 60_000);
      setAgora(Date.now());
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    }
  }
  return (
    <section data-ajuste="celular-entrar" className="janela flex flex-col">
      <div className="barra">Entrar no celular<span className="ml-auto font-medium">QR code · vale uma vez</span></div>
      <div className="flex flex-wrap items-start gap-5 p-4">
        {link && restante > 0 ? (
          <>
            <Qr texto={link} />
            <div className="flex max-w-[44ch] flex-col gap-2 text-[14px]">
              <p className="m-0"><b>Aponte a câmera do celular para o código.</b> O Stackcall abre no navegador já com a sua conta.</p>
              <p className="m-0 text-texto-fraco">Vale uma vez, por mais {Math.floor(restante / 60)}:{String(restante % 60).padStart(2, '0')} min. Não mande este código para ninguém: ele entra como você.</p>
              <p className="m-0 text-texto-fraco">No celular, abra Configurações › Celular para ligar os avisos do Bora? e das cutucadas.</p>
              <button type="button" className="btn self-start" onClick={() => setLink(null)}>Esconder o código</button>
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="m-0 max-w-[52ch] text-[14px] text-texto-fraco">Gera um código que entra no celular com a sua conta, sem senha e sem convite novo.</p>
            <button type="button" className="btn btn-prim self-start" onClick={() => void gerar()}>Mostrar QR code</button>
          </div>
        )}
        {erro && <p role="alert" className="m-0 basis-full text-perigo">Não deu para gerar o código. {erro}</p>}
      </div>
    </section>
  );
}

const b64url = (buf: ArrayBuffer | null) =>
  buf ? btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : '';
const chaveBytes = (b64: string) => {
  const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

type EstadoAvisos = 'carregando' | 'sem-suporte' | 'instalar' | 'desligado' | 'ligado' | 'bloqueado';

function AvisosNoCelular({ servidor }: { servidor: Servidor }) {
  const [estado, setEstado] = useState<EstadoAvisos>('carregando');
  const [erro, setErro] = useState<string>();
  const iphone = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const instalado = matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

  useEffect(() => {
    void (async () => {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || typeof Notification === 'undefined') {
        // On the iPhone, Web Push exists only after "Add to Home Screen".
        return setEstado(iphone && !instalado ? 'instalar' : 'sem-suporte');
      }
      if (Notification.permission === 'denied') return setEstado('bloqueado');
      const registro = await navigator.serviceWorker.register('/app/sw.js', { scope: '/app/' }).catch(() => null);
      const atual = await registro?.pushManager.getSubscription().catch(() => null);
      setEstado(atual ? 'ligado' : 'desligado');
    })();
  }, [iphone, instalado]);

  async function ligar() {
    setErro(undefined);
    try {
      const permissao = await Notification.requestPermission();
      if (permissao !== 'granted') return setEstado(permissao === 'denied' ? 'bloqueado' : 'desligado');
      const registro = await navigator.serviceWorker.register('/app/sw.js', { scope: '/app/' });
      await navigator.serviceWorker.ready;
      const inscricao = await registro.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chaveBytes(await servidor.pushChave()) });
      await servidor.pushInscrever({ endpoint: inscricao.endpoint, p256dh: b64url(inscricao.getKey('p256dh')), auth: b64url(inscricao.getKey('auth')) });
      setEstado('ligado');
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    }
  }

  async function desligar() {
    setErro(undefined);
    const registro = await navigator.serviceWorker.getRegistration('/app/').catch(() => undefined);
    const inscricao = await registro?.pushManager.getSubscription().catch(() => null);
    if (inscricao) {
      await servidor.pushRemover(inscricao.endpoint).catch(() => undefined);
      await inscricao.unsubscribe().catch(() => undefined);
    }
    setEstado('desligado');
  }

  return (
    <section data-ajuste="celular-avisos" className="janela flex flex-col">
      <div className="barra">Avisos no celular<span className="ml-auto font-medium">Bora? e cutucadas</span></div>
      <div className="flex flex-col gap-3 p-4 text-[14px]">
        {estado === 'carregando' && <p className="m-0 text-texto-fraco">Verificando…</p>}
        {estado === 'instalar' && (
          <p className="m-0">No iPhone, os avisos só funcionam com o Stackcall na tela de início: toque em <b>Compartilhar</b> › <b>Adicionar à Tela de Início</b> e abra pelo ícone.</p>
        )}
        {estado === 'sem-suporte' && <p className="m-0 text-texto-fraco">Este navegador não recebe avisos. Use o Chrome no Android ou o Safari no iPhone com o app na tela de início.</p>}
        {estado === 'bloqueado' && <p className="m-0">Os avisos estão bloqueados para este site. Libere nas configurações do navegador (cadeado ao lado do endereço) e volte aqui.</p>}
        {estado === 'desligado' && (
          <>
            <p className="m-0 text-texto-fraco">Receba um aviso quando alguém chamar com o Bora? ou te cutucar, mesmo com o app fechado.</p>
            <button type="button" className="btn btn-prim self-start" onClick={() => void ligar()}>Ligar avisos</button>
          </>
        )}
        {estado === 'ligado' && (
          <>
            <p className="m-0"><b>Avisos ligados neste celular.</b> Quem recebe cutucadas de você (Configurações › Cutucadas) também recebe o Bora?.</p>
            <button type="button" className="btn self-start" onClick={() => void desligar()}>Desligar avisos</button>
          </>
        )}
        {erro && <p role="alert" className="m-0 text-perigo">Não deu para ligar os avisos. {erro}</p>}
      </div>
    </section>
  );
}
