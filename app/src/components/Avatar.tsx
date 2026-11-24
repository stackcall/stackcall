import type { Usuario } from '../lib/servidor';

/** Stable pastel per name, readable with ink text in both themes. */
const CORES = ['#d9cffd', '#b9e3d4', '#f2d3a8', '#c4d4f5', '#f5c4d6', '#d8e6a8', '#e9c58f'];
export function corDe(nome: string) {
  let h = 0;
  for (const c of nome) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return CORES[h % CORES.length];
}
export const inicial = (nome: string) => (nome.trim()[0] ?? '?').toUpperCase();

/** Square avatar with an ink border; the photo when there is one, else the initial in Anton. */
export function Avatar({ pessoa, tamanho = 56, className = '' }: { pessoa: Pick<Usuario, 'nome' | 'avatar'>; tamanho?: number; className?: string }) {
  const estilo = { width: tamanho, height: tamanho, fontSize: Math.round(tamanho * 0.43) };
  return pessoa.avatar ? (
    <img src={pessoa.avatar} alt="" width={tamanho} height={tamanho} decoding="async"
      className={`shrink-0 border border-texto object-cover ${className}`} style={estilo} />
  ) : (
    <span aria-hidden="true" className={`font-display flex shrink-0 items-center justify-center border border-texto text-[#111] ${className}`}
      style={{ ...estilo, background: corDe(pessoa.nome), lineHeight: 1 }}>
      {inicial(pessoa.nome)}
    </span>
  );
}
