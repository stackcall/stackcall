export const AVATAR = { largura: 256, altura: 256 };
export const BANNER = { largura: 1200, altura: 400 };
const TIPOS = ['image/png', 'image/jpeg', 'image/webp'];
const LIMITE = 1024 * 1024;
function validar(arquivo) {
    if (!TIPOS.includes(arquivo.type))
        throw new Error('Use uma imagem PNG, JPEG ou WebP.');
}
export async function carregarImagem(arquivo) {
    validar(arquivo);
    const url = URL.createObjectURL(arquivo);
    try {
        return await new Promise((ok, erro) => {
            const img = new Image();
            img.onload = () => ok(img);
            img.onerror = () => erro(new Error('Não foi possível abrir essa imagem.'));
            img.src = url;
        });
    }
    finally {
        URL.revokeObjectURL(url);
    }
}
/** Cover-fit plus zoom; x/y in -1..1 are a fraction of the overflow. Shared by canvas and CSS preview. */
export function posicao(iw, ih, w, h, { zoom, x, y }) {
    const escala = Math.max(w / iw, h / ih) * zoom;
    const dw = iw * escala;
    const dh = ih * escala;
    return { dw, dh, dx: (w - dw) / 2 + (x * (dw - w)) / 2, dy: (h - dh) / 2 + (y * (dh - h)) / 2 };
}
export async function recortar(arquivo, largura, altura, corte) {
    const img = await carregarImagem(arquivo);
    const canvas = document.createElement('canvas');
    canvas.width = largura;
    canvas.height = altura;
    const ctx = canvas.getContext('2d');
    if (!ctx)
        throw new Error('Seu sistema não conseguiu processar a imagem.');
    const { dx, dy, dw, dh } = posicao(img.naturalWidth, img.naturalHeight, largura, altura, corte);
    ctx.drawImage(img, dx, dy, dw, dh);
    for (let q = 0.85; q > 0.2; q -= 0.15) {
        const blob = await new Promise((ok) => canvas.toBlob(ok, 'image/webp', q));
        if (blob && blob.type === 'image/webp' && blob.size <= LIMITE)
            return blob;
    }
    throw new Error('A imagem ficou grande demais (máximo 1 MB). Tente outra.');
}
