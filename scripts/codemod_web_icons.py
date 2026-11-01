#!/usr/bin/env python3
"""One-shot codemod: route web lucide-react JSX usages through the unified <Icon>.
Rewrites <Glyph .../> -> <Icon name="mapped" tone="current" .../> (visually
identical: className drives size+color, currentColor inherits). Files that pass
icons as component references are handled manually and excluded here."""
import re, glob, os, sys

ROOT = "/app/frontend/src"
EXCLUDE = {
    "components/Icon.jsx",
}

MAP = {
    "Users": "crew", "Sailboat": "boatOwner", "Handshake": "boatPro",
    "Compass": "hub", "ShieldCheck": "verified", "Star": "reviews",
    "MessageCircle": "messages", "CalendarDays": "events", "Pencil": "edit",
    "Trash2": "delete", "X": "close", "Share2": "share", "Send": "send",
    "Search": "search", "MapPin": "location", "User": "profile", "Bell": "notifications",
    "Menu": "menu", "LogOut": "logout", "Briefcase": "myListing", "Megaphone": "myEvents",
    "ChevronRight": "chevron-right", "ChevronLeft": "chevron-left", "ChevronDown": "chevron-down",
    "Plus": "add", "Check": "check", "CheckCheck": "checkDouble", "Eye": "visibility",
    "EyeOff": "visibilityOff", "CheckCircle2": "success", "AlertCircle": "error",
    "Info": "info", "AlertTriangle": "warning",
    "Activity": "activity", "Anchor": "anchor", "ArrowDown": "arrow-down",
    "ArrowLeft": "arrow-left", "ArrowRight": "arrow-right", "ArrowUp": "arrow-up",
    "Award": "award", "Ban": "ban", "BellOff": "bell-off", "BellRing": "bell-ring",
    "BookOpen": "book-open", "Calendar": "calendar", "CalendarPlus": "calendar-plus",
    "Camera": "camera", "Circle": "circle", "ClipboardCheck": "clipboard-check",
    "Clock": "clock", "Copy": "copy", "CornerDownRight": "corner-down-right",
    "Crown": "crown", "Download": "download", "ExternalLink": "external-link",
    "FileCheck": "file-check", "Flag": "flag", "Gift": "gift", "Globe": "globe",
    "HandHeart": "hand-heart", "History": "history", "Image": "image",
    "ImagePlus": "image-plus", "Images": "images", "Inbox": "inbox",
    "LayoutList": "layout-list", "Link2": "link", "List": "list", "Loader2": "spinner",
    "Mail": "mail", "Map": "map", "MapPinned": "map-pinned", "MessageSquare": "message-square",
    "MessagesSquare": "messages-square", "Monitor": "monitor", "Moon": "moon", "Phone": "phone",
    "RefreshCw": "refresh", "Repeat": "repeat", "Rocket": "rocket", "RotateCw": "rotate",
    "ShieldAlert": "shield-alert", "Sparkles": "sparkles", "Sun": "sun", "Tag": "tag",
    "ThumbsDown": "thumbs-down", "ThumbsUp": "thumbs-up", "Ticket": "ticket",
    "TrendingUp": "trending-up", "Trophy": "trophy", "Upload": "upload", "UserPlus": "user-plus",
}

IMPORT_RE = re.compile(r'import\s*\{([^}]*)\}\s*from\s*["\']lucide-react["\'];?\n?', re.S)

def process(path):
    src = open(path).read()
    imports = IMPORT_RE.findall(src)
    if not imports:
        return None
    names = []
    for blk in imports:
        for n in blk.split(','):
            n = n.strip().split(' as ')[0].strip()
            if n:
                names.append(n)
    unknown = [n for n in names if n not in MAP]
    src = IMPORT_RE.sub('', src)
    has_icon = 'from "@/components/Icon"' in src or "from '@/components/Icon'" in src
    for n in names:
        if n not in MAP:
            continue
        mapped = MAP[n]
        # self-closing tag
        def sc(m):
            attrs = m.group(1) or " "
            if not attrs.startswith((" ", "\n", "\t")):
                attrs = " " + attrs
            return f'<Icon name="{mapped}" tone="current"{attrs}/>'
        src = re.sub(r'<' + n + r'(?=[\s/>])((?:\s[^>]*?)?)/>', sc, src)
        # opening tag with children (rare for icons)
        src = re.sub(r'<' + n + r'(?=[\s>])', f'<Icon name="{mapped}" tone="current"', src)
        src = re.sub(r'</' + n + r'(?=[\s>])', '</Icon', src)
    # add Icon import if needed
    if not has_icon:
        m = re.search(r'^(import .*?;\n)', src, re.M)
        if m:
            src = src[:m.end()] + 'import { Icon } from "@/components/Icon";\n' + src[m.end():]
        else:
            src = 'import { Icon } from "@/components/Icon";\n' + src
    # report leftover bare refs (identifier not part of a tag we produced)
    leftover = []
    for n in names:
        if re.search(r'(?<![<\w"\'/.])' + n + r'\b', src):
            # ignore if it only appears inside the (now removed) import — re-check
            leftover.append(n)
    return src, unknown, leftover

def main():
    files = []
    for ext in ("jsx", "js"):
        files += glob.glob(f"{ROOT}/**/*.{ext}", recursive=True)
    total, reports = 0, []
    for f in sorted(files):
        rel = os.path.relpath(f, ROOT)
        if rel in EXCLUDE or rel.startswith("components/ui/") or rel == "lib/eventCategories.js":
            continue
        res = process(f)
        if not res:
            continue
        new, unknown, leftover = res
        open(f, "w").write(new)
        total += 1
        if unknown:
            reports.append(f"  ! {rel}: UNKNOWN glyphs (not migrated): {unknown}")
        if leftover:
            reports.append(f"  ~ {rel}: possible bare refs remaining: {leftover}")
    print(f"Rewrote {total} web files.")
    print("\n".join(reports) if reports else "No unknown glyphs or bare-ref warnings.")

if __name__ == "__main__":
    main()
