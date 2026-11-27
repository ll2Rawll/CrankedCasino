"""Convert freshly rendered card PNGs to WebP."""
import sys, os
from PIL import Image

out = sys.argv[1]
for f in sorted(os.listdir(out)):
    if f.startswith('card-') and f.endswith('.png'):
        src = os.path.join(out, f)
        Image.open(src).convert('RGBA').save(src.replace('.png', '.webp'), 'WEBP', quality=88, method=6)
        os.remove(src)
print('card art converted to WebP')
