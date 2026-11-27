"""Post-process renders: WebP versions, brand tile, app icons."""
import sys, os
from PIL import Image, ImageDraw, ImageFilter

out, tmp = sys.argv[1], sys.argv[2]

def webp(name, quality=86):
    src = os.path.join(out, name)
    im = Image.open(src).convert('RGBA')
    im.save(src.replace('.png', '.webp'), 'WEBP', quality=quality, method=6)
    os.remove(src)

for f in sorted(os.listdir(out)):
    if f.startswith(('hero-', 'card-', 'thumb-')) and f.endswith('.png'):
        webp(f)

def backdrop(size, radius_frac=0.0):
    w = h = size
    bg = Image.new('RGBA', (w, h), (8, 8, 10, 255))
    glow = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(glow)
    d.ellipse([-w * 0.3, -h * 0.45, w * 1.0, h * 0.75], fill=(58, 58, 66, 255))
    glow = glow.filter(ImageFilter.GaussianBlur(size * 0.18))
    bg.alpha_composite(glow)
    return bg

tile = Image.open(os.path.join(tmp, 'logo-tile.png')).convert('RGBA')
tile.save(os.path.join(out, 'logo-tile.png'), optimize=True)

big = Image.open(os.path.join(tmp, 'logo-512.png')).convert('RGBA')
for size, name in [(180, 'apple-touch-icon.png'), (192, 'icon-192.png'), (512, 'icon-512.png')]:
    bg = backdrop(512)
    bg.alpha_composite(big)
    bg.convert('RGB').resize((size, size), Image.LANCZOS).save(os.path.join(out, name), optimize=True)
print('assets finished')
