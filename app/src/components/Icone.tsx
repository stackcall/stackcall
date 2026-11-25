/** Square-cap stroke icons from the approved prototype. Decorative: the button carries the label. */
const CAMINHOS = {
  ajustes: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M14 4h4v4h-4zM8 10h4v4H8zM16 16h4v4h-4z',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  tela: 'M3 4h18v12H3zM8 20h8M12 16v4',
  cheia: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  mic: 'M9 3h6v11H9zM5 11a7 7 0 0 0 14 0M12 18v3',
  'mic-off': 'M9 3h6v11H9zM5 11a7 7 0 0 0 14 0M12 18v3M4 4l16 16',
  fone: 'M4 15v-3a8 8 0 0 1 16 0v3M3 14h5v7H3zM16 14h5v7h-5z',
  'fone-off': 'M4 15v-3a8 8 0 0 1 16 0v3M3 14h5v7H3zM16 14h5v7h-5zM3 3l18 18',
  sair: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10',
  enviar: 'M5 12h14M13 6l6 6-6 6',
  amigo: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a7 7 0 0 1 14 0v1M19 8v6M16 11h6',
  'amigo-off': 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a7 7 0 0 1 14 0v1M16 11h6',
  mais: 'M12 5v14M5 12h14',
  fechar: 'M6 6l12 12M18 6L6 18',
  copiar: 'M8 8h12v12H8zM16 8V4H4v12h4',
  busca: 'M10 4a6 6 0 1 0 0 12 6 6 0 1 0 0-12zM15 15l5 5',
  voz: 'M4 9h4l5-4v14l-5-4H4zM16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11',
  play: 'M7 4l13 8-13 8z',
  pasta: 'M3 6h7l2 2h9v11H3z',
  filme: 'M3 5h18v14H3zM7 5v14M17 5v14M3 9.5h4M3 14.5h4M17 9.5h4M17 14.5h4',
  rede: 'M5 19v-3M10 19v-7M15 19v-11M20 19V5',
} as const;

export function Icone({ nome, tamanho = 18 }: { nome: keyof typeof CAMINHOS; tamanho?: number }) {
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" aria-hidden="true">
      <path d={CAMINHOS[nome]} />
    </svg>
  );
}
