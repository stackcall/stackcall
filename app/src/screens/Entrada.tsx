import { useEffect, useState, type FormEvent } from 'react';
import { lerConvite, type LinkConvite } from '../lib/convite';
import { NAME_PATTERN, store } from '../lib/config';
import { type Previa, type Servidor, type Usuario } from '../lib/servidor';
import { SERVIDOR_OFICIAL, lerServidores } from '../lib/servidores';

type Props = {
  /** Link that arrived by deep link or was pasted earlier. */
  link: LinkConvite | null;
  servidorDe(url: string): Servidor;
  onLink(link: LinkConvite | null): void;
  onEntrou(servidor: Servidor, nomeServidor: string, eu: Usuario): void;
  onConfig(): void;
  /** Already logged in somewhere: lets the person go back. */
  onVoltar?(): void;
};

/** No password and no address to type: the invite link brings the server, the person types a name. */
export function Entrada({ link, servidorDe, onLink, onEntrou, onConfig, onVoltar }: Props) {
  return (
    <div className="grid h-full grid-cols-[minmax(0,1.1fr)_minmax(380px,0.9fr)] items-center gap-10 overflow-y-auto px-14 py-10">
      <div className="flex flex-col gap-5">
        <span className="font-display text-[34px] leading-none">stack<span className="text-destaque">call</span></span>
        <h1 className="text-[104px]">Bora pra <span className="font-pincel inline-block -rotate-3 text-[0.8em] text-destaque normal-case">call</span></h1>
        <p className="m-0 max-w-[46ch] text-[17px] text-texto-fraco">
          Voz, tela e conversa com a sua turma. Não tem senha nem cadastro: quem já está no grupo manda um link de convite.
        </p>
        <span className="rotulo">v{__APP_VERSION__}</span>
      </div>
      <div className="flex flex-col gap-3">
        {link ? (
          <ComLink key={`${link.servidor}/${link.codigo}`} link={link} servidor={servidorDe(link.servidor)} onTrocar={() => onLink(null)} onEntrou={onEntrou} />
        ) : (
          <ColarLink onLink={onLink} />
        )}
        <div className="flex flex-wrap items-center gap-2">
          {onVoltar && <button type="button" className="btn btn-fant" onClick={onVoltar}>Voltar para o servidor</button>}
          <button type="button" className="btn btn-fant ml-auto" onClick={onConfig}>Sobre e atualizações</button>
        </div>
      </div>
    </div>
  );
}

function ColarLink({ onLink }: { onLink(link: LinkConvite): void }) {
  const [texto, setTexto] = useState('');
  const [erro, setErro] = useState<string>();
  function enviar(e: FormEvent) {
    e.preventDefault();
    const link = lerConvite(texto);
    if (!link) return setErro('Isso não parece um link de convite. Ele começa com https:// e tem /c/ no meio.');
    setErro(undefined);
    onLink(link);
  }
  return (
    <form onSubmit={enviar} className="janela flex flex-col" aria-label="Entrar com convite">
      <div className="barra">Entrar com convite</div>
      <div className="flex flex-col gap-3 p-5">
        <label htmlFor="link" className="font-bold">Colar link de convite</label>
        <input id="link" className="campo" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="https://servidor/c/…"
          autoComplete="off" spellCheck={false} aria-invalid={!!erro} aria-describedby="link-ajuda" />
        <span id="link-ajuda" className={`text-[13px] ${erro ? 'text-perigo' : 'text-texto-fraco'}`} role={erro ? 'alert' : undefined}>
          {erro ?? 'Recebeu o link no celular? Cole aqui. Se abrir o link neste PC, o app já entra sozinho.'}
        </span>
        <button type="submit" className="btn btn-prim btn-lg" disabled={!texto.trim()}>Continuar</button>
      </div>
    </form>
  );
}

function ComLink({ link, servidor, onTrocar, onEntrou }: {
  link: LinkConvite; servidor: Servidor; onTrocar(): void; onEntrou: Props['onEntrou'];
}) {
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [erroPrevia, setErroPrevia] = useState<string>();
  const [nome, setNome] = useState(() => store.get('nome') ?? '');
  const [erro, setErro] = useState<string>();
  const [ocupado, setOcupado] = useState(false);
  const conhecido = link.servidor === SERVIDOR_OFICIAL || lerServidores().some((s) => s.url === link.servidor);
  const host = new URL(link.servidor).host;

  useEffect(() => {
    if (link.aparelho) return;
    let vivo = true;
    servidor.previa(link.codigo).then((p) => vivo && setPrevia(p), (e: Error) => vivo && setErroPrevia(e.message));
    return () => { vivo = false; };
  }, [servidor, link]);

  async function entrar(e: FormEvent) {
    e.preventDefault();
    if (!link.aparelho && !NAME_PATTERN.test(nome.trim())) return setErro('O nome deve ter de 1 a 32 caracteres, sem dois-pontos.');
    setOcupado(true);
    setErro(undefined);
    try {
      const eu = link.aparelho ? await servidor.entrarAparelho(link.codigo) : await servidor.aceitar(link.codigo, nome.trim());
      store.set('nome', eu.nome);
      const info = await servidor.info().catch(() => ({ nome: previa?.servidor || host, versao: '' }));
      onEntrou(servidor, info.nome, eu);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
      setOcupado(false);
    }
  }

  if (erroPrevia) {
    return (
      <div className="janela flex flex-col">
        <div className="barra">Convite</div>
        <div className="flex flex-col gap-3 p-5">
          <p role="alert" className="m-0 text-perigo">{erroPrevia}</p>
          <button type="button" className="btn" onClick={onTrocar}>Colar outro link</button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={entrar} className="janela flex flex-col" aria-label="Entrar no servidor" aria-busy={!previa && !link.aparelho}>
      <div className="barra barra-lima">{link.aparelho ? 'Entrar neste aparelho' : 'Convite'}<span className="ml-auto truncate font-medium">{host}</span></div>
      <div className="flex flex-col gap-4 p-5">
        {link.aparelho ? (
          <p className="m-0">Este link entra com a sua conta neste PC. Ele vale uma vez só, por 10 minutos.</p>
        ) : previa ? (
          <div className="flex flex-col gap-1">
            <span className="rotulo">{previa.convidadoPor ? `${previa.convidadoPor} chamou você para` : 'Você foi chamado para'}</span>
            <b className="font-display text-[48px]">{previa.servidor || host}</b>
          </div>
        ) : (
          <div className="flex flex-col gap-2"><span className="skeleton h-4 w-40" /><span className="skeleton h-12 w-64" /></div>
        )}
        {!conhecido && (
          <p className="m-0 border border-texto bg-superficie-alta px-3 py-2 text-[14px]">
            Este servidor não é o oficial: <b>{host}</b>. Entre só se conhece quem mandou o link.
          </p>
        )}
        {!link.aparelho && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="nome" className="font-bold">Seu nome</label>
            <input id="nome" className="campo" value={nome} onChange={(e) => setNome(e.target.value)} autoComplete="nickname" maxLength={32}
              aria-invalid={!!erro} aria-describedby="nome-ajuda" autoFocus />
            <span id="nome-ajuda" className="text-[13px] text-texto-fraco">É como a galera vê você.</span>
          </div>
        )}
        {erro && <p role="alert" className="m-0 text-perigo">{erro}</p>}
        <div className="flex gap-2">
          <button type="button" className="btn" onClick={onTrocar} disabled={ocupado}>Outro link</button>
          <button type="submit" className="btn btn-prim btn-lg flex-1" disabled={ocupado || (!previa && !link.aparelho)}>
            {ocupado ? 'Entrando…' : conhecido ? 'Entrar' : `Entrar em ${host}`}
          </button>
        </div>
      </div>
    </form>
  );
}
