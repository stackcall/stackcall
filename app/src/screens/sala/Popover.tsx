import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/** Where a panel opens: next to the element that called it (design rule "painel nasce de onde foi chamado"). */
export type Ancora = { x: number; y: number };

/**
 * Fixed panel kept inside the window, closed with Esc or a click outside. Focus goes inside on open
 * and returns to the caller on close.
 */
export function Popover({ ancora, onFechar, rotulo, role = 'dialog', className = '', children }: {
  ancora: Ancora; onFechar(): void; rotulo: string; role?: 'dialog' | 'menu'; className?: string; children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const antes = useRef<Element | null>(document.activeElement);

  // Kept inside the window, also when the content grows (a confirmation, a submenu).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ajustar = () => {
      const margem = 8;
      setPos({
        left: Math.max(margem, Math.min(ancora.x, innerWidth - el.offsetWidth - margem)),
        top: Math.max(margem, Math.min(ancora.y, innerHeight - el.offsetHeight - margem)),
      });
    };
    ajustar();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(ajustar);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ancora.x, ancora.y]);

  useEffect(() => {
    const el = ref.current;
    (el?.querySelector<HTMLElement>('[autofocus], input, [role="menuitem"], button') ?? el)?.focus();
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onFechar();
      }
    };
    const fora = (e: MouseEvent) => {
      if (el && !el.contains(e.target as Node)) onFechar();
    };
    window.addEventListener('keydown', tecla, true);
    window.addEventListener('mousedown', fora, true);
    const voltar = antes.current;
    return () => {
      window.removeEventListener('keydown', tecla, true);
      window.removeEventListener('mousedown', fora, true);
      if (voltar instanceof HTMLElement && document.contains(voltar)) voltar.focus();
    };
  }, [onFechar]);

  return (
    <div ref={ref} role={role} aria-label={rotulo} tabIndex={-1}
      className={`janela fixed z-40 outline-none ${className}`}
      style={pos ? { left: pos.left, top: pos.top } : { left: ancora.x, top: ancora.y, visibility: 'hidden' }}>
      {children}
    </div>
  );
}

/** Up and down arrows (and Home/End) move between the items of a menu. */
export function navegarMenu(e: React.KeyboardEvent<HTMLElement>) {
  const itens = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')];
  const i = itens.indexOf(document.activeElement as HTMLElement);
  const ir = (n: number) => {
    e.preventDefault();
    itens[(n + itens.length) % itens.length]?.focus();
  };
  if (e.key === 'ArrowDown') ir(i + 1);
  else if (e.key === 'ArrowUp') ir(i - 1);
  else if (e.key === 'Home') ir(0);
  else if (e.key === 'End') ir(itens.length - 1);
}
