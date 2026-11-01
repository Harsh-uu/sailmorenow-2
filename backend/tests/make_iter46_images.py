"""Create the iter45-failing 4000x3000 noisy PNG + a 2000x1500 regression PNG."""
import numpy as np
from PIL import Image, ImageFilter

out = {}
for name, (w, h), blur in (("big_noise_4000x3000.png", (4000, 3000), 0.5),
                           ("mid_noise_2000x1500.png", (2000, 1500), 1.2)):
    arr = np.random.randint(0, 255, (h, w, 3), dtype=np.uint8)
    img = Image.fromarray(arr).filter(ImageFilter.GaussianBlur(blur))
    p = f"/tmp/{name}"
    img.save(p)
    out[name] = p
    print(name, p)

with open("/tmp/not_an_image.txt", "w") as f:
    f.write("this is definitely not an image\n" * 20)
print("not_an_image", "/tmp/not_an_image.txt")
