#!/usr/bin/env python3
"""Route mobile @expo/vector-icons <Ionicons> usages through the unified <Icon>.
Every <Ionicons name size color .../> becomes <Icon name size color footprint={size} .../>
(footprint=size keeps the icon inline; <Icon> falls back to a raw Ionicons glyph
for any name that isn't a semantic registry key). Icon.tsx is the only file left
importing @expo/vector-icons."""
import re, glob, os

ROOT = "/app/mobile"
EXCLUDE = {"src/components/Icon.tsx"}

ION_RE = re.compile(r'<Ionicons\b([^>]*?)/>', re.S)
SIZE_RE = re.compile(r'size=\{([^}]*)\}')
IMPORT_RE = re.compile(r'import\s*\{\s*Ionicons\s*\}\s*from\s*["\']@expo/vector-icons["\'];?\n?')

def conv(m):
    attrs = m.group(1)
    sm = SIZE_RE.search(attrs)
    fp = f' footprint={{{sm.group(1)}}}' if sm else ''
    return f'<Icon{attrs}{fp}/>'

def process(path):
    src = open(path).read()
    if '@expo/vector-icons' not in src:
        return None
    src = src.replace('keyof typeof Ionicons.glyphMap', 'string')
    src = ION_RE.sub(conv, src)
    src = IMPORT_RE.sub('', src)
    if 'from "@/src/components/Icon"' not in src:
        m = re.search(r'^(import .*?;\n)', src, re.M)
        ins = 'import { Icon } from "@/src/components/Icon";\n'
        src = (src[:m.end()] + ins + src[m.end():]) if m else ins + src
    return src

def main():
    files = glob.glob(f"{ROOT}/app/**/*.tsx", recursive=True) + glob.glob(f"{ROOT}/src/**/*.tsx", recursive=True)
    n = 0
    leftover = []
    for f in sorted(files):
        rel = os.path.relpath(f, ROOT)
        if rel in EXCLUDE:
            continue
        res = process(f)
        if res is None:
            continue
        open(f, "w").write(res)
        n += 1
        if 'Ionicons' in res or 'MaterialCommunityIcons' in res:
            leftover.append(rel)
    print(f"Rewrote {n} mobile files.")
    if leftover:
        print("Files still referencing a vector-icons symbol (check):")
        for r in leftover:
            print("  ", r)

if __name__ == "__main__":
    main()
