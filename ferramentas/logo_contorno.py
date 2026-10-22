"""logo_contorno.py — logo da Lube transparente, com um contorno branco uniforme em volta (Júlio, 2026-10-22:
"quero deixar ela mais bonita, ela precisa estar transparente apenas com um contornozinho branco em volta pra
aparecer").

Parte da logo em alta (2172x724, fundo transparente, ver "Identidade visual da Lube" no cérebro):
  1. fica só o que tem cor (o azul e o vermelho da marca); sai o relevo cinza e o contorno branco irregular da arte;
  2. as letras brancas de DISTRIBUIDORA (dentro da faixa vermelha) voltam, porque ficam dentro do contorno novo;
  3. contorno branco: a parte colorida "engordada" por igual (desfoque + corte), com a borda suave;
  4. a parte colorida por cima, com a borda original (que já mistura com o branco).

Uso:  python -I -X utf8 ferramentas\\logo_contorno.py ORIGEM.png SAIDA.png [ALTURA] [CONTORNO]
      CONTORNO = espessura do branco em fração da altura (0.017 padrão). Na tela o branco precisa de ~1,5 px:
      logo pequena (topo do app, ~26 px de altura) pede contorno mais grosso que a grande (entrada, ~64 px).
"""
import sys
from PIL import Image, ImageChops, ImageFilter

origem, saida = sys.argv[1], sys.argv[2]
altura_final = int(sys.argv[3]) if len(sys.argv) > 3 else 300
espessura = float(sys.argv[4]) if len(sys.argv) > 4 else 0.017

logo = Image.open(origem).convert("RGBA")
r, g, b, a = logo.split()

# 1. o que tem cor: saturação alta (max - min) e visível
mx = ImageChops.lighter(ImageChops.lighter(r, g), b)
mn = ImageChops.darker(ImageChops.darker(r, g), b)
sat = ImageChops.subtract(mx, mn)
cor = sat.point(lambda v: 255 if v > 70 else (0 if v < 35 else int((v - 35) * 255 / 35)))
cor = ImageChops.multiply(cor, a)

# 3. contorno: engorda a parte colorida ~1,7% da altura, por igual e com a borda redonda
raio = max(2, round(logo.height * espessura))
gordo = cor.filter(ImageFilter.GaussianBlur(raio))
# borda firme (um "contornozinho", não um brilho): sobe de 0 a 255 numa faixa curta
contorno = gordo.point(lambda v: 255 if v > 30 else (0 if v < 14 else int((v - 14) * 255 / 16)))
# fecha os buracos pequenos (miolo das letras fica branco, como numa etiqueta)
contorno = contorno.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.GaussianBlur(0.8))

branco = Image.new("RGBA", logo.size, (255, 255, 255, 0))
branco.putalpha(contorno)

# 4. parte colorida por cima: os pixels originais onde há cor ou onde a arte é branca dentro do contorno
#    (as letras de DISTRIBUIDORA); fora disso, só o branco do contorno
claro = ImageChops.multiply(mn.point(lambda v: 255 if v > 200 else 0), a)      # branco da arte
miolo = ImageChops.multiply(claro, cor.filter(ImageFilter.GaussianBlur(raio * 0.6)).point(lambda v: 255 if v > 90 else 0))
manter = ImageChops.lighter(cor, miolo)
topo = logo.copy()
topo.putalpha(ImageChops.multiply(manter, a))

final = Image.new("RGBA", logo.size, (0, 0, 0, 0))
final.alpha_composite(branco)
final.alpha_composite(topo)

# corta a sobra transparente, deixa uma margem e reduz para o tamanho de tela
caixa = final.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
m = round(logo.height * 0.02)
final = final.crop((max(0, caixa[0] - m), max(0, caixa[1] - m), min(logo.width, caixa[2] + m), min(logo.height, caixa[3] + m)))
largura = round(final.width * altura_final / final.height)
final = final.resize((largura, altura_final), Image.LANCZOS)
final.save(saida, optimize=True)
print(f"ok {final.size[0]}x{final.size[1]} -> {saida}")
