#!/usr/bin/env node
// Builds the /Docs section of the Ren POS site from the guides that ship with
// the app (renpos/help in the renpos repository), so the site and the in-app
// help never drift apart.
//
//   node apps/ren-webpage/tools/sync-docs.mjs [source]
//
// source: a local renpos checkout (or its renpos/help folder), or nothing to
// read the develop branch on GitHub. Then update the app from the Desk
// (App Manager > ren-webpage > Update) so the pages and the menu are loaded.
//
// What it writes:
//   modules/ren-web/pages/docs-*/   one Page Builder page per guide
//   installer.json                  the pages and the Docs menu (parent "Docs",
//                                   one child per guide, old routes kept as
//                                   router-only links to their new guide)

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MODULE = "ren-web";
const PAGES_DIR = path.join(APP_DIR, "modules", MODULE, "pages");
const INSTALLER = path.join(APP_DIR, "installer.json");
const GITHUB = "https://raw.githubusercontent.com/alphabit-technology/renpos/develop/renpos/help";
const DOCS = "Docs";

// Sidebar labels (and URLs: /Docs/<label>). Derived from the slug unless set here.
const LABELS = { stations: "Production Centers", "pos-profile": "POS Profile" };

// Routes of the old hand-written pages -> the guide that replaces them.
const OLD_ROUTES = {
  Help: "overview",
  "Getting Started": "overview",
  Combos: "options-and-combos",
  Kitchen: "kitchen-screen",
  Menus: "menus-and-items",
  Reservations: "reservations-setup",
  Payments: "paying",
  Administration: "manager-tasks",
  FAQ: "troubleshooting",
};

// Illustration styles: the classes used in renpos/help/svg, on the site theme.
const FIGURE_CSS = `<style>
.rh-figure{margin:16px 0 24px}
.rh-figure svg{width:100%;height:auto;display:block;font-family:inherit;overflow:visible}
.rh-figure text{fill:hsl(var(--foreground));font-size:13px}
.rh-figure text.sm{font-size:11.5px}
.rh-figure text.lg{font-size:15px;font-weight:600}
.rh-figure text.b,.rh-figure tspan.b{font-weight:600}
.rh-figure .muted{fill:hsl(var(--muted-foreground))}
.rh-figure .box{fill:hsl(var(--card));stroke:hsl(var(--border));stroke-width:1.2}
.rh-figure .soft{fill:hsl(var(--muted));stroke:none}
.rh-figure .line{fill:none;stroke:hsl(var(--muted-foreground));stroke-width:1.4}
.rh-figure .dash{fill:none;stroke:hsl(var(--muted-foreground));stroke-width:1.2;stroke-dasharray:4 4}
.rh-figure .arrow{fill:hsl(var(--muted-foreground))}
.rh-figure .blue{fill:rgb(37 99 235 / .14);stroke:#2563eb;stroke-width:1.4}
.rh-figure .green{fill:rgb(22 163 74 / .14);stroke:#16a34a;stroke-width:1.4}
.rh-figure .orange{fill:rgb(234 88 12 / .14);stroke:#ea580c;stroke-width:1.4}
.rh-figure .red{fill:rgb(220 38 38 / .14);stroke:#dc2626;stroke-width:1.4}
.rh-figure .purple{fill:rgb(124 58 237 / .14);stroke:#7c3aed;stroke-width:1.4}
.rh-figure .t-blue{fill:#3b82f6}.rh-figure .t-green{fill:#22c55e}.rh-figure .t-orange{fill:#f97316}
.rh-figure .t-red{fill:#ef4444}.rh-figure .t-purple{fill:#8b5cf6}
.rh-figure .s-blue{stroke:#2563eb}.rh-figure .s-green{stroke:#16a34a}
</style>`;

// ---------------------------------------------------------------- source

async function openSource(arg) {
  if (!arg) {
    const get = async (rel) => {
      const r = await fetch(`${GITHUB}/${rel}`);
      if (!r.ok) throw new Error(`${rel}: HTTP ${r.status}`);
      return r.text();
    };
    return { where: GITHUB, read: get, tryRead: (rel) => get(rel).catch(() => null) };
  }
  let dir = path.resolve(arg);
  for (const sub of ["renpos/help", "help"]) {
    if (fs.existsSync(path.join(dir, sub, "index.json"))) { dir = path.join(dir, sub); break; }
  }
  if (!fs.existsSync(path.join(dir, "index.json"))) throw new Error(`No help/index.json under ${arg}`);
  const read = async (rel) => fs.readFileSync(path.join(dir, rel), "utf8");
  return { where: dir, read, tryRead: (rel) => read(rel).catch(() => null) };
}

// ---------------------------------------------------------------- helpers

const titleCase = (s) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
const SMALL = new Set(["and", "or", "of", "the", "a", "to"]);
const labelOf = (slug) =>
  LABELS[slug] ||
  slug.split("-").map((w, i) => (i && SMALL.has(w) ? w : titleCase(w))).join(" ");
const pageName = (slug) => `${DOCS} ${titleCase(slug.replace(/-/g, " "))}`; // no acronyms: file names derive from it
const fileName = (name) => name.replace(/\s+/g, "-").toLowerCase();
const className = (name) => name.replace(/\s+/g, "");
const docsUrl = (slug) => `/${DOCS}/${encodeURIComponent(labelOf(slug))}`;
const stableId = (s) => crypto.createHash("sha1").update(s).digest("base64").replace(/[^A-Za-z0-9]/g, "").slice(0, 15);
const headingId = (text) =>
  text.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/\s+/g, "-");
const titleOf = (md, slug) => (md.match(/^# (.+)$/m)?.[1] || labelOf(slug)).trim();

async function figure(src, name) {
  const svg = await src.tryRead(`svg/${name}.svg`);
  if (!svg) {
    console.warn(`  ! svg ${name} not found`);
    return "";
  }
  // one HTML block: no blank lines inside, blank lines around
  const body = svg.split("\n").map((l) => l.trim()).filter(Boolean).join("\n");
  return `\n<figure class="rh-figure">\n${body}\n</figure>\n`;
}

// guide markdown -> sections [{label, value}]
async function sections(src, md, slug, known) {
  let text = md.replace(/\r\n/g, "\n");

  // links between guides
  text = text.replace(/\]\(help:([a-z0-9-]+)(#[^)]*)?\)/g, (m, s, anchor) => {
    if (!known.has(s)) console.warn(`  ! ${slug}: link to unknown guide ${s}`);
    return `](${docsUrl(s)}${anchor || ""})`;
  });

  // illustrations
  const names = [...text.matchAll(/^\s*\{\{svg:([a-z0-9-]+)\}\}\s*$/gm)].map((m) => m[1]);
  for (const name of new Set(names)) {
    const html = await figure(src, name);
    text = text.replace(new RegExp(`^\\s*\\{\\{svg:${name}\\}\\}\\s*$`, "gm"), html);
  }

  // split on "## " (outside code fences); each section's headings move up a
  // level so the page menu lists its "###" subheadings
  const out = [];
  let cur = null;
  let fence = false;
  for (const line of text.split("\n")) {
    if (/^\s{0,3}(```|~~~)/.test(line)) fence = !fence;
    const h2 = !fence && line.match(/^## (.+)$/);
    if (h2 || !cur) {
      cur = { label: h2 ? h2[1].trim() : titleOf(text, slug), lines: [], promote: !!h2 };
      out.push(cur);
    }
    cur.lines.push(cur.promote && !fence ? line.replace(/^(#{2,6}) /, (m, h) => `${h.slice(1)} `) : line);
  }

  let styled = false;
  return out
    .map((s) => {
      let value = s.lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
      if (!styled && value.includes('class="rh-figure"')) {
        value = `${FIGURE_CSS}\n\n${value}`;
        styled = true;
      }
      return { label: s.label, value };
    })
    .filter((s) => s.value);
}

function writePage(name, secs) {
  const file = fileName(name);
  const dir = path.join(PAGES_DIR, file);
  fs.mkdirSync(dir, { recursive: true });

  const key = file.replace(/-/g, "_");
  let n = 100;
  const used = new Set();
  const elements = secs.map((s) => {
    let id = headingId(s.label) || `section-${n}`;
    while (used.has(id)) id += "-x";
    used.add(id);
    n++;
    return {
      node: `markdown${n}`,
      element: "markdown",
      data: { label: s.label, key: `md_${id.replace(/-/g, "_")}`, id, name: `md_${id.replace(/-/g, "_")}`, value: s.value },
    };
  });
  const structure = [
    {
      node: `menu_content${n + 1}`,
      element: "menu_content",
      data: { label: name, key: `${key}_menu_content`, id: `${key}_menu_content`, name: `${key}_menu_content` },
      elements,
    },
  ];

  const doc = {
    name,
    module: MODULE,
    enable_history: 0,
    enable_comments: 0,
    __ENTITY__: "Page Builder",
    doc_structure: JSON.stringify(structure),
  };
  fs.writeFileSync(path.join(dir, `${file}.json`), JSON.stringify(doc, null, 1) + "\n");

  const cls = className(name);
  const js = path.join(dir, `${file}.js`);
  if (!fs.existsSync(js)) {
    fs.writeFileSync(js, `'use strict';\n\nimport {BaseDocument} from 'loopar';\n\nexport default class ${cls} extends BaseDocument {\n    constructor(props){\n        super(props);\n    }\n}\n`);
  }
  const ctl = path.join(dir, `${file}-controller.js`);
  if (!fs.existsSync(ctl)) {
    fs.writeFileSync(ctl, `'use strict';\n\nimport {PageController} from 'loopar';\n\nexport default class ${cls}Controller extends PageController {\n    constructor(props){\n        super(props);\n    }\n}\n`);
  }
  return `/apps/ren-webpage/modules/${MODULE}/pages/${file}`;
}

function menuItem(page, link, parent = "", routerOnly = 0) {
  return {
    parent_document: "App",
    name: stableId(`${parent}/${link}`),
    page,
    link,
    parent_menu: parent,
    document_parent_name: null,
    router_only: routerOnly,
  };
}

// ---------------------------------------------------------------- main

const src = await openSource(process.argv[2]);
console.log(`Guides from ${src.where}`);

const index = JSON.parse(await src.read("index.json"));
const slugs = index.flatMap((s) => s.pages);
const known = new Set(slugs);

const installer = JSON.parse(fs.readFileSync(INSTALLER, "utf8"));
const documents = installer.documents;
const app = documents[`App:${installer.App.name}`];

const docsMenu = [];
for (const slug of slugs) {
  const md = await src.tryRead(`pages/${slug}.md`);
  if (md == null) {
    console.warn(`  ! guide ${slug} not found, skipped`);
    continue;
  }
  const name = pageName(slug);
  const root = writePage(name, await sections(src, md, slug, known));
  documents[`Page Builder:${name}`] = { __root__: root };
  docsMenu.push({ slug, name });
  console.log(`  ${docsUrl(slug)}  <- ${slug}.md`);
}

const first = docsMenu[0].name;
const generated = new Set([DOCS, ...docsMenu.map((d) => labelOf(d.slug)), ...Object.keys(OLD_ROUTES)].map((l) => l.toLowerCase()));
const kept = app.menu_items.filter(
  (m) => m.parent_menu !== "Help" && m.parent_menu !== DOCS && !generated.has(String(m.link).toLowerCase())
);
const at = Math.max(kept.findIndex((m) => m.link === "Features") + 1, 0) || kept.length;
app.menu_items = [
  ...kept.slice(0, at),
  menuItem(first, DOCS),
  ...docsMenu.map((d) => menuItem(d.name, labelOf(d.slug), DOCS)),
  ...kept.slice(at),
  ...Object.entries(OLD_ROUTES)
    .filter(([, slug]) => known.has(slug))
    .map(([link, slug]) => menuItem(pageName(slug), link, "", 1)),
];

fs.writeFileSync(INSTALLER, JSON.stringify(installer, null, 4) + "\n");
console.log(`${docsMenu.length} guides written. Now update ren-webpage from the Desk (App Manager).`);
