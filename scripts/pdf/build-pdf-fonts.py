#!/usr/bin/env python3
"""
Fuentes TTF para el PDF del viaje (src/lib/tripPdf.ts).

jsPDF solo incrusta TrueType (.ttf) y las fuentes de la marca en public/fonts son WOFF2 variables
(Google Fonts, subconjuntos latin y latin-ext, OFL 1.1). Este script:
  1. fija cada peso (instancia estática) de Fraunces y Manrope,
  2. une latin + latin-ext en un solo archivo (los glifos de latin-ext se copian descompuestos),
  3. agrega los signos que esas fuentes no traen y el PDF necesita: → ★ ☆ ✓ ↗ (dibujados aquí, con el
     grosor del peso), para que el texto extraído del PDF diga "→" y "★" y no "!'" o "&",
  4. quita las tablas que jsPDF no usa (OpenType layout, variaciones) para que pesen poco.

Uso (requiere fonttools y brotli):  python3 scripts/pdf/build-pdf-fonts.py
Salida: public/fonts/pdf/*.ttf (se descargan solo al tocar "Compartir PDF").
"""
import math
import os

from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SRC = os.path.join(ROOT, "public", "fonts")
OUT = os.path.join(SRC, "pdf")

# (archivo de salida, familia, estilo, PostScript, ejes, ¿con latin-ext?)
# Fraunces (títulos) va solo con latin: sus glifos de latin-ext descompuestos triplican el peso. Si un
# título trae una letra que no tiene, tripPdf.ts lo escribe con Manrope (que sí lleva latin-ext).
INSTANCES = [
    ("fraunces-display.ttf", "fraunces", "Fraunces", "Display", "Fraunces-Display", {"wght": 420, "opsz": 96}, False),
    ("fraunces-semibold.ttf", "fraunces", "Fraunces", "SemiBold", "Fraunces-SemiBold", {"wght": 600, "opsz": 28}, False),
    ("manrope-regular.ttf", "manrope", "Manrope", "Regular", "Manrope-Regular", {"wght": 400}, True),
    ("manrope-semibold.ttf", "manrope", "Manrope", "SemiBold", "Manrope-SemiBold", {"wght": 600}, True),
    ("manrope-extrabold.ttf", "manrope", "Manrope", "ExtraBold", "Manrope-ExtraBold", {"wght": 800}, True),
]
SRC_FILES = {
    "fraunces": ("fraunces-latin-v38.woff2", "fraunces-latin-ext-v38.woff2"),
    "manrope": ("manrope-latin-v20.woff2", "manrope-latin-ext-v20.woff2"),
}
DROP = ["GSUB", "GPOS", "GDEF", "STAT", "HVAR", "MVAR", "avar", "fvar", "gvar", "cvar", "DSIG", "meta", "prep", "gasp"]


def instance(path, axes):
    f = TTFont(path)
    return instancer.instantiateVariableFont(f, axes, inplace=False)


def unicode_cmaps(font):
    return [t for t in font["cmap"].tables if t.isUnicode()]


def add_glyph(font, name, glyph, advance, codepoint):
    order = font.getGlyphOrder()
    if name in order:
        return
    glyf = font["glyf"]
    glyf.glyphs[name] = glyph
    glyph.recalcBounds(glyf)
    order = list(order) + [name]
    font.setGlyphOrder(order)
    glyf.glyphOrder = order
    font["hmtx"][name] = (int(round(advance)), getattr(glyph, "xMin", 0) or 0)
    if codepoint is not None:
        for t in unicode_cmaps(font):
            if t.format in (4, 12) or t.format == 0 and codepoint < 256:
                t.cmap[codepoint] = name


def copy_missing(dst, src):
    """Glifos de src (latin-ext) que dst (latin) no tiene, descompuestos."""
    dmap = dst.getBestCmap()
    smap = src.getBestCmap()
    gs = src.getGlyphSet()
    for cp, gname in sorted(smap.items()):
        if cp in dmap:
            continue
        rec = DecomposingRecordingPen(gs)
        gs[gname].draw(rec)
        pen = TTGlyphPen(None)
        rec.replay(pen)
        add_glyph(dst, f"u{cp:04X}", pen.glyph(), src["hmtx"][gname][0], cp)


# ───────────── Signos dibujados (en unidades del em) ─────────────

def _clockwise(pts):
    # TrueType: contornos exteriores en sentido horario (área negativa con y hacia arriba).
    area = sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts)))
    return pts if area < 0 else list(reversed(pts))


def _poly(pen, pts):
    pts = _clockwise([(int(round(x)), int(round(y))) for x, y in pts])
    pen.moveTo(pts[0])
    for p in pts[1:]:
        pen.lineTo(p)
    pen.closePath()


def _stroke(pen, a, b, t, cap=0.0):
    """Trazo recto de a a b con grosor t (rectángulo), extendido `cap` en ambos extremos."""
    dx, dy = b[0] - a[0], b[1] - a[1]
    ln = math.hypot(dx, dy) or 1
    ux, uy = dx / ln, dy / ln
    nx, ny = -uy * t / 2, ux * t / 2
    a = (a[0] - ux * cap, a[1] - uy * cap)
    b = (b[0] + ux * cap, b[1] + uy * cap)
    _poly(pen, [(a[0] + nx, a[1] + ny), (b[0] + nx, b[1] + ny), (b[0] - nx, b[1] - ny), (a[0] - nx, a[1] - ny)])


def draw_symbols(font, wght):
    upm = font["head"].unitsPerEm
    em = lambda v: v * upm  # noqa: E731
    xh = font["OS/2"].sxHeight or em(0.5)
    cap = font["OS/2"].sCapHeight or em(0.7)
    t = em(0.052 + max(0, wght - 300) / 500 * 0.05)  # grosor según el peso

    # → (flecha a la derecha) a media altura de la x
    pen = TTGlyphPen(None)
    y = xh * 0.52
    x0, x1 = em(0.08), em(0.70)
    _stroke(pen, (x0, y), (x1 - t * 0.6, y), t)
    head = em(0.2)
    _stroke(pen, (x1, y), (x1 - head, y + head), t, cap=t * 0.35)
    _stroke(pen, (x1, y), (x1 - head, y - head), t, cap=t * 0.35)
    add_glyph(font, "arrowright", pen.glyph(), em(0.78), 0x2192)

    # ↗ (enlace externo)
    pen = TTGlyphPen(None)
    a, b = (em(0.12), em(0.04)), (em(0.56), cap * 0.66)
    _stroke(pen, a, (b[0] - t * 0.4, b[1] - t * 0.4), t)
    _stroke(pen, b, (b[0] - em(0.3), b[1]), t, cap=t * 0.4)
    _stroke(pen, b, (b[0], b[1] - em(0.3)), t, cap=t * 0.4)
    add_glyph(font, "arrownortheast", pen.glyph(), em(0.68), 0x2197)

    # ★ y ☆ (estrella de cinco puntas)
    def star_pts(cx, cy, r_out, r_in):
        pts = []
        for i in range(10):
            ang = math.pi / 2 + i * math.pi / 5
            r = r_out if i % 2 == 0 else r_in
            pts.append((cx + r * math.cos(ang), cy + r * math.sin(ang)))
        return pts

    cx, cy, ro = em(0.42), cap * 0.46, em(0.37)
    pen = TTGlyphPen(None)
    _poly(pen, star_pts(cx, cy, ro, ro * 0.42))
    add_glyph(font, "blackstar", pen.glyph(), em(0.84), 0x2605)

    pen = TTGlyphPen(None)
    outer = _clockwise([(int(round(x)), int(round(y))) for x, y in star_pts(cx, cy, ro, ro * 0.42)])
    inner = list(reversed(_clockwise([(int(round(x)), int(round(y))) for x, y in star_pts(cx, cy, ro - t * 1.6, (ro - t * 1.6) * 0.42)])))
    for contour in (outer, inner):
        pen.moveTo(contour[0])
        for p in contour[1:]:
            pen.lineTo(p)
        pen.closePath()
    add_glyph(font, "whitestar", pen.glyph(), em(0.84), 0x2606)

    # ✓ (palomita)
    pen = TTGlyphPen(None)
    p0, p1, p2 = (em(0.1), cap * 0.42), (em(0.3), cap * 0.12), (em(0.66), cap * 0.78)
    _stroke(pen, p0, p1, t * 1.1, cap=t * 0.3)
    _stroke(pen, p1, p2, t * 1.1, cap=t * 0.3)
    add_glyph(font, "checkmark", pen.glyph(), em(0.76), 0x2713)


def set_names(font, family, style, ps):
    name = font["name"]
    full = f"{family} {style}"
    for rec in list(name.names):
        if rec.nameID in (1, 2, 3, 4, 6, 16, 17, 25):
            name.removeNames(nameID=rec.nameID)
    for pid, eid, lid in ((3, 1, 0x409), (1, 0, 0)):
        name.setName(family, 1, pid, eid, lid)
        name.setName(style if style in ("Regular", "Bold") else "Regular", 2, pid, eid, lid)
        name.setName(f"{ps};IATOS-PDF", 3, pid, eid, lid)
        name.setName(full, 4, pid, eid, lid)
        name.setName(ps, 6, pid, eid, lid)


def main():
    os.makedirs(OUT, exist_ok=True)
    for out, key, family, style, ps, axes, with_ext in INSTANCES:
        latin, ext = SRC_FILES[key]
        f = instance(os.path.join(SRC, latin), axes)
        if with_ext:
            copy_missing(f, instance(os.path.join(SRC, ext), axes))
        draw_symbols(f, axes["wght"])
        for tag in DROP:
            if tag in f:
                del f[tag]
        f["post"].formatType = 3.0
        f["post"].glyphOrder = None
        set_names(f, family, style, ps)
        f.flavor = None
        path = os.path.join(OUT, out)
        f.save(path)
        print(f"{out}: {os.path.getsize(path) // 1024} KB, {len(f.getGlyphOrder())} glifos")


if __name__ == "__main__":
    main()
