#!/usr/bin/env python3
"""Puts the product illustrations (tools/site-art/*.svg) into the Home and
Features pages of ren-webpage. Run it again after editing an SVG or ill.css;
then update the app from the Desk so the pages are reloaded.

    python3 apps/ren-webpage/tools/apply_art.py

Each illustration is a markdown element labelled "Illustration: <name>"
holding <figure class="rp-ill"><svg>…</svg></figure>; the first one on each
page also carries the stylesheet (ill.css), which draws the SVG classes with
the site theme colors, so the pictures follow light and dark mode.
"""
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
ART = os.path.join(HERE, "site-art")
PAGES = os.path.join(HERE, "..", "modules", "ren-web", "pages")
LABEL = "Illustration: "


def css():
    with open(os.path.join(ART, "ill.css")) as f:
        return "<style>\n" + f.read().strip() + "\n.rp-ill{margin:0}\n</style>"


def figure(name):
    with open(os.path.join(ART, f"{name}.svg")) as f:
        svg = "\n".join(l.strip() for l in f.read().splitlines() if l.strip())
    return f'<figure class="rp-ill">\n{svg}\n</figure>'


_n = [900]


def art(name):
    _n[0] += 1
    key = f"ill_{name.replace('-', '_')}"
    return {"node": f"markdown{_n[0]}", "element": "markdown",
            "data": {"label": LABEL + name, "key": key, "id": key, "name": key, "value": figure(name)}}


def load(page):
    path = os.path.join(PAGES, page, f"{page}.json")
    with open(path) as f:
        doc = json.load(f)
    return path, doc, json.loads(doc["doc_structure"])


def save(path, doc, structure):
    doc["doc_structure"] = json.dumps(structure, ensure_ascii=False)
    with open(path, "w") as f:
        json.dump(doc, f, indent=1, ensure_ascii=False)
        f.write("\n")


def walk(nodes):
    for e in nodes:
        yield e
        yield from walk(e.get("elements", []))


def section(structure, label):
    for e in walk(structure):
        if e["element"] == "section" and e["data"].get("label") == label:
            return e
    raise SystemExit(f"section {label!r} not found")


def put_in_col(sec, col_index, name):
    """Replace what the column of the section's first row shows with the illustration."""
    row = next(e for e in sec["elements"] if e["element"] == "row")
    col = row["elements"][col_index]
    col["elements"] = [art(name)]


def plain_eyebrows(structure):
    # small labels above the titles: sentence case, no tracking
    for e in walk(structure):
        if e["element"] == "subtitle":
            cls = e["data"].get("class", "")
            e["data"]["class"] = re.sub(r"\s*\b(uppercase|tracking-wider)\b", "", cls).strip()


def home():
    path, doc, s = load("ren-home")

    hero = section(s, "Hero section")
    row = next(e for e in hero["elements"] if e["element"] == "row")
    row["data"]["layout"] = "[45,55]"
    put_in_col(hero, 1, "hero")
    for e in walk(hero["elements"]):
        if e["element"] == "generic":
            e["data"]["inner_text"] = "Open-source restaurant POS for ERPNext"
        if e["element"] == "paragraph" and "v16" in e["data"].get("text", ""):
            e["data"]["text"] = "Runs on Frappe and ERPNext v16, on tablets, phones and kitchen screens."

    put_in_col(section(s, "Front of house section"), 1, "combo")
    put_in_col(section(s, "Back of house section"), 0, "kitchen")
    put_in_col(section(s, "Online section"), 1, "online")
    put_in_col(section(s, "Host stand section"), 1, "host")
    put_in_col(section(s, "Control section"), 0, "approval")

    how = section(s, "How section")
    how["elements"] = [e for e in how["elements"] if not e["data"].get("label", "").startswith(LABEL)]
    i = next(n for n, e in enumerate(how["elements"]) if e["element"] == "row")
    how["elements"].insert(i, art("flow"))
    row = how["elements"][i + 1]
    if len(row["elements"]) == 3:
        last = json.loads(json.dumps(row["elements"][2]))
        for e in walk([last]):
            if e["element"] == "subtitle":
                e["data"]["text"] = "4 · In your books"
            if e["element"] == "paragraph":
                e["data"]["text"] = "Invoice, stock and ledger are already in ERPNext. Nothing to export or reconcile."
        row["elements"].append(last)
        row["data"]["layout"] = "[25,25,25,25]"

    # the main call to action uses the brand color, not the "destructive" red
    for e in walk(s):
        if e["element"] == "link" and e["data"].get("variant") == "destructive":
            e["data"]["variant"] = "default"

    plain_eyebrows(s)
    first = next(e for e in walk(s) if e["data"].get("label", "").startswith(LABEL))
    first["data"]["value"] = css() + "\n\n" + first["data"]["value"]
    save(path, doc, s)
    print("ren-home: hero, combo, kitchen, online, flow, host, approval")


FEATURES = {
    "Floor plan": "hero",
    "Orders": "combo",
    "Online and QR ordering": "online",
    "Delivery and pickup": "delivery",
    "Kitchen and bar": "kitchen",
    "Menus": "menus",
    "Reservations": "host",
    "Payments and cash": "payments",
    "Staff and permissions": "approval",
    "Inventory and accounting": "inventory",
    "Technology": "tech",
}
MARK = re.compile(r'\n*(<style>.*?</style>\s*)?<figure class="rp-ill">.*?</figure>\n*', re.S)


def features():
    path, doc, s = load("features")
    first = True
    for e in walk(s):
        name = FEATURES.get(e["data"].get("label"))
        if e["element"] != "markdown" or not name:
            continue
        value = MARK.sub("\n\n", e["data"]["value"]).strip()
        lines = value.split("\n", 1)  # "# Title" then the list
        block = (css() + "\n\n" if first else "") + figure(name)
        e["data"]["value"] = f"{lines[0]}\n\n{block}\n\n{lines[1].strip() if len(lines) > 1 else ''}".strip()
        first = False
    save(path, doc, s)
    print("features: " + ", ".join(FEATURES.values()))


def logos():
    """Logo of the site (light / dark, full / mini) from site-art/logo*.svg and the favicon
    (site-art/favicon.ico), as data URIs."""
    import base64
    path = os.path.join(HERE, "..", "installer.json")
    with open(path) as f:
        installer = json.load(f)
    app = installer["documents"][f"App:{installer['App']['name']}"]
    for field, name in [("logo", "logo"), ("logo_dark", "logo-dark"), ("logo_mini", "logo-mini"), ("logo_mini_dark", "logo-mini-dark")]:
        with open(os.path.join(ART, f"{name}.svg"), "rb") as f:
            app[field] = "data:image/svg+xml;base64," + base64.b64encode(f.read()).decode()
    app["logo_height"] = "32"
    # favicon of the site (the Web App's favicon takes a data URI)
    with open(os.path.join(ART, "favicon.ico"), "rb") as f:
        app["favicon"] = "data:image/x-icon;base64," + base64.b64encode(f.read()).decode()
    with open(path, "w") as f:
        json.dump(installer, f, indent=4, ensure_ascii=False)
        f.write("\n")
    print("logos set")


if __name__ == "__main__":
    logos()
    home()
    features()
