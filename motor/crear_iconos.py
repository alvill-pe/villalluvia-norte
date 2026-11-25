"""Dibuja el ícono de VillaLluvia Norte: nube con gotas sobre cielo azul y una "V" de Villalta.
Uso: python motor/crear_iconos.py"""
from pathlib import Path
from PIL import Image, ImageDraw

SALIDA = Path(__file__).resolve().parent.parent / "app" / "iconos"
SALIDA.mkdir(parents=True, exist_ok=True)
S = 1024  # se dibuja grande y se reduce, para bordes suaves


def fondo(d, margen=0):
    for y in range(S):  # degradado de cielo
        t = y / S
        c = (int(46 + (92 - 46) * t), int(127 + (164 - 127) * t), int(214 + (234 - 214) * t))
        d.line([(0, y), (S, y)], fill=c)


def dibujo(d, escala=1.0):
    c = S / 2
    def e(v):
        return c + (v - c) * escala
    # sol asomando
    d.ellipse([e(560), e(170), e(800), e(410)], fill=(255, 201, 60))
    # nube
    blanco = (255, 255, 255)
    d.ellipse([e(200), e(330), e(520), e(650)], fill=blanco)
    d.ellipse([e(380), e(250), e(760), e(630)], fill=blanco)
    d.ellipse([e(620), e(420), e(860), e(660)], fill=blanco)
    d.rounded_rectangle([e(250), e(500), e(820), e(660)], radius=int(80 * escala), fill=blanco)
    # gotas
    azul = (90, 200, 250)
    for x in (330, 500, 670):
        d.line([(e(x), e(720)), (e(x - 40), e(850))], fill=azul, width=int(52 * escala))
        d.ellipse([e(x - 26), e(694), e(x + 26), e(746)], fill=azul)
        d.ellipse([e(x - 66), e(824), e(x - 14), e(876)], fill=azul)
    # V de Villalta en la nube
    v = (45, 108, 181)
    d.line([(e(420), e(420)), (e(510), e(590))], fill=v, width=int(46 * escala))
    d.line([(e(510), e(590)), (e(600), e(420))], fill=v, width=int(46 * escala))


def crear(nombre, tam, escala=1.0, redondeado=False):
    img = Image.new("RGB", (S, S))
    d = ImageDraw.Draw(img)
    fondo(d)
    dibujo(d, escala)
    img = img.resize((tam, tam), Image.LANCZOS)
    img.save(SALIDA / nombre)


crear("icono-512.png", 512)
crear("icono-192.png", 192)
crear("apple-touch-icon.png", 180)
crear("icono-maskable-512.png", 512, escala=0.72)  # Android recorta en círculo: dejar margen

# Insignia monocroma para la barra de notificaciones de Android.
ins = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(ins)
blanco = (255, 255, 255, 255)
d.ellipse([200, 300, 520, 620], fill=blanco)
d.ellipse([380, 220, 760, 600], fill=blanco)
d.ellipse([620, 390, 860, 630], fill=blanco)
d.rounded_rectangle([250, 470, 820, 630], radius=80, fill=blanco)
for x in (330, 500, 670):
    d.line([(x, 700), (x - 40, 850)], fill=blanco, width=60)
ins.resize((96, 96), Image.LANCZOS).save(SALIDA / "insignia-96.png")
print("Íconos creados en", SALIDA)
