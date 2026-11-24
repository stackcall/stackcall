import { useEffect, useRef, useState } from 'react';
import { CartaoPerfil } from '../components/CartaoPerfil';
import { AVATAR, BANNER, carregarImagem, posicao, recortar, type Corte } from '../lib/imagem';
import type { Servidor, TemaPerfil, Usuario } from '../lib/servidor';

const CORES = [
  ['vermelho', '#c8191f'], ['azul', '#1f4fe0'], ['verde', '#1a7f37'],
  ['laranja', '#d9622b'], ['roxo', '#6b3fd4'], ['tinta', '#111111'],
] as const;
const TEMAS: [TemaPerfil, string][] = [['papel', 'Papel'], ['noite', 'Noite'], ['lima', 'Lima']];
type Tipo = 'avatar' | 'banner';
type Edicao = { tipo: Tipo; arquivo: File; img: HTMLImageElement; url: string; corte: Corte };
const TAM = { avatar: AVATAR, banner: BANNER };
const PREVIA = 280; // preview box width in px

function Recorte({ ed, onMudar, onUsar, onCancelar, ocupado }: { ed: Edicao; onMudar(c: Corte): void; onUsar(): void; onCancelar(): void; ocupado: boolean }) {
  const { largura, altura } = TAM[ed.tipo];
  const k = PREVIA / largura;
  const { naturalWidth: iw, naturalHeight: ih } = ed.img;
  const p = posicao(iw, ih, largura, altura, ed.corte);
  const arrasto = useRef<{ px: number; py: number; c: Corte } | null>(null);
  const mover = (e: React.PointerEvent) => {
    const a = arrasto.current;
    if (!a) return;
    const q = posicao(iw, ih, largura, altura, a.c);
    const livreX = ((q.dw - largura) / 2) * k;
    const livreY = ((q.dh - altura) / 2) * k;
    const lim = (v: number) => Math.max(-1, Math.min(1, v));
    onMudar({
      zoom: a.c.zoom,
      x: livreX ? lim(a.c.x + (e.clientX - a.px) / livreX) : 0,
      y: livreY ? lim(a.c.y + (e.clientY - a.py) / livreY) : 0,
    });
  };
  return (
    <div className="janela mt-3">
      <div className="barra">Ajustar {ed.tipo === 'avatar' ? 'foto' : 'banner'}</div>
      <div className="p-3">
        <div
          className="relative cursor-grab touch-none overflow-hidden border border-texto bg-superficie-alta"
          style={{ width: PREVIA, height: altura * k }}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture?.(e.pointerId);
            arrasto.current = { px: e.clientX, py: e.clientY, c: ed.corte };
          }}
          onPointerMove={mover}
          onPointerUp={() => (arrasto.current = null)}
          onPointerCancel={() => (arrasto.current = null)}
        >
          <img src={ed.url} alt="" draggable={false} className="pointer-events-none absolute max-w-none select-none"
            style={{ left: p.dx * k, top: p.dy * k, width: p.dw * k, height: p.dh * k }} />
        </div>
        <label className="rotulo mt-3 block">
          Zoom
          <input type="range" min={1} max={3} step={0.05} value={ed.corte.zoom} className="mt-1 block h-11 w-full"
            onChange={(e) => onMudar({ ...ed.corte, zoom: Number(e.target.value) })} />
        </label>
        <p className="rotulo">Arraste para posicionar.</p>
        <div className="mt-3 flex gap-2">
          <button type="button" className="btn" onClick={onCancelar}>Cancelar</button>
          <button type="button" className="btn btn-prim" disabled={ocupado} onClick={onUsar}>Usar esta foto</button>
        </div>
      </div>
    </div>
  );
}

export function Perfil({ servidor, eu, onSalvo, onFechar }: { servidor: Servidor; eu: Usuario; onSalvo(u: Usuario): void; onFechar(): void }) {
  const [bio, setBio] = useState(eu.bio);
  const [tema, setTema] = useState<TemaPerfil>(eu.tema);
  const [cor, setCor] = useState<string | null>(eu.cor);
  const [novo, setNovo] = useState<Partial<Record<Tipo, { blob: Blob; url: string }>>>({});
  const [ed, setEd] = useState<Edicao | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const arquivoRef = useRef<HTMLInputElement>(null);
  const alvo = useRef<Tipo>('avatar');
  const urls = useRef<string[]>([]);
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => e.key === 'Escape' && (ed ? setEd(null) : onFechar());
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [ed, onFechar]);

  const escolher = (tipo: Tipo) => {
    alvo.current = tipo;
    arquivoRef.current?.click();
  };
  async function aoEscolher(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    e.target.value = '';
    if (!arquivo) return;
    setErro('');
    try {
      const img = await carregarImagem(arquivo); // validates type and decodes
      const url = URL.createObjectURL(arquivo);
      urls.current.push(url);
      setEd({ tipo: alvo.current, arquivo, img, url, corte: { zoom: 1, x: 0, y: 0 } });
    } catch (x) {
      setErro((x as Error).message);
    }
  }
  async function usar() {
    if (!ed) return;
    setOcupado(true);
    try {
      const { largura, altura } = TAM[ed.tipo];
      const blob = await recortar(ed.arquivo, largura, altura, ed.corte);
      const url = URL.createObjectURL(blob);
      urls.current.push(url);
      setNovo((n) => ({ ...n, [ed.tipo]: { blob, url } }));
      setEd(null);
    } catch (x) {
      setErro((x as Error).message);
    } finally {
      setOcupado(false);
    }
  }
  async function salvar() {
    setSalvando(true);
    setErro('');
    try {
      let u = await servidor.perfil({ bio, tema, cor });
      if (novo.avatar) u = await servidor.imagem('avatar', novo.avatar.blob);
      if (novo.banner) u = await servidor.imagem('banner', novo.banner.blob);
      onSalvo(u);
    } catch (x) {
      setErro((x as Error).message || 'Não foi possível salvar.');
      setSalvando(false);
    }
  }

  const previa: Usuario = { ...eu, bio, tema, cor, avatar: novo.avatar?.url ?? eu.avatar, banner: novo.banner?.url ?? eu.banner };

  return (
    <div role="dialog" aria-modal="true" aria-label="Perfil" className="absolute inset-0 z-30 overflow-y-auto bg-fundo">
      <div className="mx-auto grid max-w-4xl gap-8 p-6 md:grid-cols-[1fr_340px]">
        <form className="min-w-0" onSubmit={(e) => { e.preventDefault(); void salvar(); }}>
          <p className="rotulo">/ Seu perfil</p>
          <h1 className="text-5xl">Perfil</h1>

          <input ref={arquivoRef} type="file" accept="image/png,image/jpeg,image/webp" hidden aria-label="Arquivo de imagem" onChange={aoEscolher} />
          <div className="mt-6 flex flex-wrap gap-2">
            <button type="button" className="btn" onClick={() => escolher('avatar')}>Trocar foto</button>
            <button type="button" className="btn" onClick={() => escolher('banner')}>Trocar banner</button>
          </div>
          {ed && <Recorte ed={ed} ocupado={ocupado} onMudar={(corte) => setEd({ ...ed, corte })} onUsar={usar} onCancelar={() => setEd(null)} />}

          <label className="rotulo mt-6 block" htmlFor="perfil-bio">Bio</label>
          <textarea id="perfil-bio" className="campo mt-1 min-h-24 py-2" maxLength={160} value={bio} onChange={(e) => setBio(e.target.value)} />
          <p className="rotulo text-right">{bio.length}/160</p>

          <p className="rotulo mt-4">Tema do cartão</p>
          <div className="abas mt-1">
            {TEMAS.map(([id, nome]) => (
              <button key={id} type="button" aria-pressed={tema === id} onClick={() => setTema(id)}>{nome}</button>
            ))}
          </div>

          <p className="rotulo mt-4">Cor de destaque</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {CORES.map(([nome, hex]) => (
              <button key={hex} type="button" aria-label={nome} aria-pressed={cor === hex} onClick={() => setCor(hex)}
                className={`h-11 w-11 border border-texto ${cor === hex ? 'outline outline-2 outline-offset-2 outline-texto' : ''}`} style={{ background: hex }} />
            ))}
          </div>

          {erro && <p role="alert" className="mt-4 border border-perigo p-3 text-sm text-perigo">{erro}</p>}
          <div className="mt-6 flex gap-2">
            <button type="button" className="btn" onClick={onFechar}>Cancelar</button>
            <button type="submit" className="btn btn-prim" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</button>
          </div>
        </form>
        <div>
          <p className="rotulo mb-2">Prévia</p>
          <CartaoPerfil pessoa={previa} comoDialogo={false} />
        </div>
      </div>
    </div>
  );
}
