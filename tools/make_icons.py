"""Generate the extension icons (run once; output is committed in src/icons)."""
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "src" / "icons"
PURPLE = (113, 75, 103, 255)  # Odoo purple
WHITE = (255, 255, 255, 255)
TEAL = (0, 160, 157, 255)  # Odoo teal
SCALE = 8  # supersampling for smooth edges


def icon(size):
    s = size * SCALE
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, s - 1, s - 1], radius=s * .22, fill=PURPLE)
    # a funnel (filter) whose spout ends in a teal "o" lens: OoFind
    w = round(s * .09)
    d.polygon([(s * .18, s * .22), (s * .82, s * .22), (s * .56, s * .52), (s * .44, s * .52)], fill=WHITE)
    d.rectangle([s * .44, s * .5, s * .56, s * .62], fill=WHITE)
    cx, cy, r = s * .5, s * .74, s * .12
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=TEAL, width=w)
    return img.resize((size, size), Image.LANCZOS)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for size in (16, 32, 48, 128):
        icon(size).save(OUT / f"icon-{size}.png")


if __name__ == "__main__":
    main()
