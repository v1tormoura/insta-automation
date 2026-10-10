"""
Upscale de foto com IA (Real-ESRGAN, via realesrgan-ncnn-py), na CPU.

    python3 upscale_ia.py <entrada> <saida.png> <rapida|maxima> <menor_lado|original>

  rapida  — realesr-animevideov3-x4 (rede compacta): segundos por foto.
  maxima  — realesrgan-x4plus: a melhor restauração, mas minutos por foto.

A rede sempre amplia 4x; depois a foto vai para o tamanho pedido pelo menor
lado ("original" = o mesmo tamanho da entrada, só que restaurada). Foto maior
que ENTRADA_MAX px no lado maior é reduzida antes: a rede 4x numa foto de
câmera passaria de 100 megapixels e levaria a memória da VPS.
Imprime "ok LARGURAxALTURA" no fim; qualquer erro sai com código != 0.
"""
import sys

from PIL import Image
from realesrgan_ncnn_py import Realesrgan

MODELOS = {'rapida': 2, 'maxima': 4}
ENTRADA_MAX = 1600


def main():
    entrada, saida, modelo, alvo = sys.argv[1:5]
    img = Image.open(entrada).convert('RGB')
    menor = min(img.size)
    if max(img.size) > ENTRADA_MAX:
        img.thumbnail((ENTRADA_MAX, ENTRADA_MAX), Image.LANCZOS)
    rede = Realesrgan(gpuid=-1, model=MODELOS[modelo])  # -1 = CPU, sem placa de vídeo
    maior = rede.process_pil(img)

    alvo = menor if alvo == 'original' else int(alvo)
    fator = alvo / min(maior.size)
    if abs(fator - 1) > 0.001:
        maior = maior.resize((max(1, round(maior.width * fator)), max(1, round(maior.height * fator))), Image.LANCZOS)
    maior.save(saida, 'PNG')
    print(f'ok {maior.width}x{maior.height}', flush=True)


if __name__ == '__main__':
    main()
