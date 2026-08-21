#!/usr/bin/env node
/**
 * Flat, intentional org logos — geometric marks, not glossy AI icons.
 * Only orgs where sarthakagrawal927 is sole/primary owner.
 *
 *   node foundry/ops/scripts/generate-org-logos.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../..");
const OUT = path.join(ROOT, "foundry/ops/assets/github-org-logos");

/** @type {Record<string, { name: string; note: string; svg: string }>} */
const ORGS = {
  Codevetter: {
    name: "CodeVetter",
    note: "Nested diamond — code gem",
    // Flat gold diamond, no chrome
    svg: `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="CodeVetter">
  <rect width="512" height="512" fill="#12141a"/>
  <path fill="#c9952e" d="M256 72 L408 256 L256 440 L104 256 Z"/>
  <path fill="#12141a" d="M256 148 L340 256 L256 364 L172 256 Z"/>
  <path fill="#e8c36a" d="M256 208 L292 256 L256 304 L220 256 Z"/>
</svg>`,
  },
  "High-Signal-App": {
    name: "High Signal",
    note: "Waveform + baseline",
    svg: `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="High Signal">
  <rect width="512" height="512" fill="#0a0a0c"/>
  <!-- baseline above the pulse, same structure as product favicon -->
  <path fill="none" stroke="#e4e4e7" stroke-width="16" stroke-linecap="round" d="M96 128 H416"/>
  <path fill="none" stroke="#22d3ee" stroke-width="30" stroke-linecap="round" stroke-linejoin="round"
    d="M80 320 H136 L184 200 L248 380 L320 220 H432"/>
</svg>`,
  },
  "Significant-Hobbies": {
    name: "Significant Hobbies",
    note: "Soft life stamp — single ring + center",
    // Lifestyle: one calm ring (life) and a solid center (you). No interlocking tech motifs.
    svg: `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="Significant Hobbies">
  <rect width="512" height="512" fill="#047857"/>
  <circle cx="256" cy="256" r="132" fill="none" stroke="#ecfdf5" stroke-width="40"/>
  <circle cx="256" cy="256" r="48" fill="#ecfdf5"/>
</svg>`,
  },
  HeyPace: {
    name: "Pace",
    note: "Four pace bars",
    svg: `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="Pace">
  <rect width="512" height="512" fill="#000000"/>
  <rect x="92"  y="220" width="56" height="120" rx="18" fill="#4f8bff"/>
  <rect x="184" y="140" width="56" height="240" rx="18" fill="#4f8bff"/>
  <rect x="276" y="176" width="56" height="184" rx="18" fill="#4f8bff"/>
  <rect x="368" y="228" width="48" height="104" rx="16" fill="#4f8bff"/>
</svg>`,
  },
  PostTrainLLM: {
    name: "PostTrainLLM",
    note: "Training curve",
    // Loss falls then flattens — classic training curve, left → right
    svg: `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="PostTrainLLM">
  <rect width="512" height="512" fill="#0d0e10"/>
  <path fill="none" stroke="#48e5c2" stroke-width="28" stroke-linecap="round" stroke-linejoin="round"
    d="M80 120 C140 120 168 360 260 380 C330 396 360 396 416 396"/>
  <circle cx="416" cy="396" r="34" fill="#48e5c2"/>
  <circle cx="416" cy="396" r="16" fill="#0d0e10"/>
</svg>`,
  },
  "sass-maker": {
    name: "Foundry",
    note: "Gold layers — operating stack (option B)",
    svg: `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="Foundry">
  <rect width="512" height="512" fill="#0c0a06"/>
  <path fill="#f5c542" d="M256 88 L420 168 L256 248 L92 168 Z"/>
  <path fill="#f0d878" d="M256 188 L420 268 L256 348 L92 268 Z"/>
  <path fill="#d4a017" d="M256 288 L420 368 L256 448 L92 368 Z"/>
</svg>`,
  },
};

fs.mkdirSync(OUT, { recursive: true });

// Remove logos for orgs we do not sole-own
const REMOVE = [
  "vaultwealth-ltd",
  "manipalthetalk",
  "ADG-Manipal",
];
for (const slug of REMOVE) {
  for (const f of fs.readdirSync(OUT)) {
    if (f.startsWith(slug)) {
      fs.unlinkSync(path.join(OUT, f));
      console.log("removed", f);
    }
  }
}

const svgPaths = [];
for (const [slug, org] of Object.entries(ORGS)) {
  const svgPath = path.join(OUT, `${slug}-mark.svg`);
  fs.writeFileSync(svgPath, org.svg.trim() + "\n", "utf8");
  svgPaths.push({ slug, svgPath, note: org.note, name: org.name });
  console.log("svg", path.relative(ROOT, svgPath));
}

// Rasterize via Python (PIL) by parsing simple SVG geometry is hard;
// write a companion raster script that draws the same marks flatly.
const py = path.join(OUT, "_rasterize.py");
fs.writeFileSync(
  py,
  `#!/usr/bin/env python3
"""Flat raster of org logos — matches the SVG marks."""
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent

def save(slug, draw_fn, bg):
    for size in (1024, 512):
        im = Image.new("RGB", (size, size), bg)
        d = ImageDraw.Draw(im)
        draw_fn(d, size)
        im.save(OUT / f"{slug}-avatar-{size}.png", "PNG", optimize=True)
    # jpg preview from 512
    Image.open(OUT / f"{slug}-avatar-512.png").save(OUT / f"{slug}-avatar.jpg", "JPEG", quality=90)
    print("png", slug)

def scale(n, size):
    return int(n * size / 512)

# --- Codevetter ---
def codevetter(d, s):
    def p(*pts):
        return [(scale(x, s), scale(y, s)) for x, y in pts]
    d.polygon(p((256,72),(408,256),(256,440),(104,256)), fill="#c9952e")
    d.polygon(p((256,148),(340,256),(256,364),(172,256)), fill="#12141a")
    d.polygon(p((256,208),(292,256),(256,304),(220,256)), fill="#e8c36a")

# --- High Signal ---
def high_signal(d, s):
    y = scale(156, s)
    d.line([(scale(88,s), y), (scale(424,s), y)], fill="#e4e4e7", width=max(2, scale(14,s)))
    pts = [(72,340),(128,340),(176,168),(248,392),(320,200),(368,300),(440,300)]
    pts = [(scale(x,s), scale(y,s)) for x,y in pts]
    d.line(pts, fill="#22d3ee", width=max(4, scale(28,s)), joint="curve")

# --- Significant Hobbies (simple life stamp) ---
def sh(d, s):
    w = max(4, scale(40, s))
    r = 132
    d.ellipse(
        [scale(256 - r, s), scale(256 - r, s), scale(256 + r, s), scale(256 + r, s)],
        outline="#ecfdf5",
        width=w,
    )
    r = 48
    d.ellipse(
        [scale(256 - r, s), scale(256 - r, s), scale(256 + r, s), scale(256 + r, s)],
        fill="#ecfdf5",
    )

# --- Pace ---
def pace(d, s):
    bars = [(92,220,56,120,18),(184,140,56,240,18),(276,176,56,184,18),(368,228,48,104,16)]
    for x,y,w,h,r in bars:
        d.rounded_rectangle(
            [scale(x,s), scale(y,s), scale(x+w,s), scale(y+h,s)],
            radius=scale(r,s),
            fill="#4f8bff",
        )

# --- PostTrainLLM ---
def posttrain(d, s):
    # approximate curve with polyline
    import math
    pts = []
    for i in range(0, 101):
        t = i / 100
        # cubic-ish: start (72,128) mid dip then rise to (420,408)
        x = 72 + (420-72)*t
        # hand-tuned y for loss-like then rise — match SVG path roughly
        # SVG: C140 128, 168 340, 264 380 then to 420 408
        if t < 0.45:
            u = t / 0.45
            y = 128 + (340-128)*u*u
        else:
            u = (t - 0.45) / 0.55
            y = 340 + (408-340)*u - 40*math.sin(u*math.pi)*0.3
            y = 128 + (408-128)*(0.3 + 0.7*u**0.8)
        # better: use quadratic samples from control points
        pts.append((scale(x,s), scale(y,s)))
    # rewrite with better Bezier sampling
    def bez(p0,p1,p2,p3, n=40):
        out=[]
        for i in range(n+1):
            t=i/n
            u=1-t
            x=u**3*p0[0]+3*u**2*t*p1[0]+3*u*t**2*p2[0]+t**3*p3[0]
            y=u**3*p0[1]+3*u**2*t*p1[1]+3*u*t**2*p2[1]+t**3*p3[1]
            out.append((scale(x,s), scale(y,s)))
        return out
    # two segments matching SVG
    a = bez((72,128),(140,128),(168,340),(264,380), 30)
    b = bez((264,380),(328,408),(360,408),(420,408), 20)[1:]
    pts = a + b
    d.line(pts, fill="#48e5c2", width=max(4, scale(28,s)), joint="curve")
    r = scale(36, s)
    cx, cy = scale(420,s), scale(408,s)
    d.ellipse([cx-r, cy-r, cx+r, cy+r], fill="#48e5c2")
    r2 = scale(18, s)
    d.ellipse([cx-r2, cy-r2, cx+r2, cy+r2], fill="#0d0e10")

# --- sass-maker / Foundry copper F ---
def foundry(d, s):
    d.rounded_rectangle(
        [scale(56,s), scale(56,s), scale(456,s), scale(456,s)],
        radius=scale(80,s),
        fill="#e07b3a",
    )
    d.polygon([
        (scale(152,s), scale(128,s)),
        (scale(360,s), scale(128,s)),
        (scale(348,s), scale(188,s)),
        (scale(230,s), scale(188,s)),
        (scale(222,s), scale(232,s)),
        (scale(332,s), scale(232,s)),
        (scale(320,s), scale(288,s)),
        (scale(210,s), scale(288,s)),
        (scale(190,s), scale(384,s)),
        (scale(140,s), scale(384,s)),
    ], fill="#1a0f06")

save("Codevetter", codevetter, "#12141a")
save("High-Signal-App", high_signal, "#0a0a0c")
save("Significant-Hobbies", sh, "#047857")
save("HeyPace", pace, "#000000")
save("PostTrainLLM", posttrain, "#0d0e10")
save("sass-maker", foundry, "#0b0d12")
print("done")
`,
  "utf8",
);

execFileSync("python3", [py], { stdio: "inherit" });
fs.unlinkSync(py);

// README
fs.writeFileSync(
  path.join(OUT, "README.md"),
  `# GitHub organization logos

Flat geometric avatars for **orgs you own** (sole admin). No glossy AI-icon look.

## Orgs included

| Org | Mark | Settings |
|---|---|---|
| [Codevetter](https://github.com/Codevetter) | Nested diamond | [profile](https://github.com/organizations/Codevetter/settings/profile) |
| [High-Signal-App](https://github.com/High-Signal-App) | Waveform + baseline | [profile](https://github.com/organizations/High-Signal-App/settings/profile) |
| [Significant-Hobbies](https://github.com/Significant-Hobbies) | Soft life stamp (ring + center) | [profile](https://github.com/organizations/Significant-Hobbies/settings/profile) |
| [HeyPace](https://github.com/HeyPace) | Four pace bars | [profile](https://github.com/organizations/HeyPace/settings/profile) |
| [PostTrainLLM](https://github.com/PostTrainLLM) | Training curve | [profile](https://github.com/organizations/PostTrainLLM/settings/profile) |
| [sass-maker](https://github.com/sass-maker) | Copper **F** (Foundry) | [profile](https://github.com/organizations/sass-maker/settings/profile) |

## Intentionally excluded

- **vaultwealth-ltd** — co-owned; not sole owner
- **manipalthetalk**, **ADG-Manipal** — member only, not owner

## Files

\`{Org}-mark.svg\` — vector source (authoritative)  
\`{Org}-avatar-1024.png\` — upload this to GitHub  
\`{Org}-avatar-512.png\` / \`{Org}-avatar.jpg\` — previews

## Regenerate

\`\`\`bash
node foundry/ops/scripts/generate-org-logos.mjs
\`\`\`

## Design rules

- Flat fills, hard edges, 2–3 colors
- No chrome, neon glow, bevels, or lens flare
- Same family as product favicons
- Marks work at 16px and 1024px

## Upload

GitHub has no org-avatar API. Settings → Profile → upload \`*-avatar-1024.png\`.

\`\`\`bash
open foundry/ops/assets/github-org-logos/preview.html
open foundry/ops/assets/github-org-logos
\`\`\`
`,
  "utf8",
);

// preview HTML
fs.writeFileSync(
  path.join(OUT, "preview.html"),
  `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Org logos (owned only)</title>
  <style>
    :root { color-scheme: dark; }
    body { margin:0; font-family: ui-sans-serif, system-ui, sans-serif; background:#0b0d10; color:#e8eaed; padding:32px 24px 64px; }
    h1 { font-size:1.25rem; margin:0 0 6px; }
    p { color:#9aa3af; margin:0 0 28px; max-width:40rem; line-height:1.5; font-size:.95rem; }
    .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(200px,1fr)); gap:18px; }
    .card { background:#14181f; border:1px solid #232a35; border-radius:14px; padding:16px; text-align:center; }
    .card img.sq { width:128px; height:128px; border-radius:24px; object-fit:cover; }
    .card img.sm { width:40px; height:40px; border-radius:8px; object-fit:cover; margin-top:10px; }
    .card strong { display:block; margin-top:12px; font-size:.9rem; }
    .card span { color:#8b95a5; font-size:.75rem; }
    a { color:#7dd3fc; font-size:.78rem; text-decoration:none; }
    a:hover { text-decoration:underline; }
  </style>
</head>
<body>
  <h1>Owned org logos</h1>
  <p>Flat geometric marks — sole-admin orgs only. Upload the 1024px PNG on each org’s profile settings.</p>
  <div class="grid" id="g"></div>
  <script>
    const items = ${JSON.stringify(
      Object.entries(ORGS).map(([slug, o]) => [slug, o.note]),
    )};
    document.getElementById('g').innerHTML = items.map(([org, note]) => \`
      <article class="card">
        <img class="sq" src="\${org}-avatar-512.png" alt="\${org}" />
        <img class="sm" src="\${org}-avatar-512.png" alt="" />
        <strong>\${org}</strong>
        <span>\${note}</span><br/>
        <a href="https://github.com/organizations/\${org}/settings/profile" target="_blank" rel="noreferrer">Upload →</a>
      </article>\`).join('');
  </script>
</body>
</html>
`,
  "utf8",
);

console.log("\\nAll set →", path.relative(ROOT, OUT));
