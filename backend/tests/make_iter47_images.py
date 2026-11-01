"""Iter47 fixtures: the iter46 4000x3000 noisy PNG plus an 8000x6000 pure
random-noise PNG that should require the 900-px rung of the cap ladder."""
import numpy as np
from PIL import Image, ImageFilter

specs = [
    ("big_noise_4000x3000.png", (4000, 3000), 0.5),
    ("huge_noise_8000x6000.png", (8000, 6000), 0.0),
]
for name, (w, h), blur in specs:
    arr = np.random.randint(0, 255, (h, w, 3), dtype=np.uint8)
    img = Image.fromarray(arr)
    if blur:
        img = img.filter(ImageFilter.GaussianBlur(blur))
    p = f"/tmp/{name}"
    img.save(p)
    print(name, p)

with open("/tmp/not_an_image.txt", "w") as f:
    f.write("this is definitely not an image\n" * 20)
print("not_an_image /tmp/not_an_image.txt")
