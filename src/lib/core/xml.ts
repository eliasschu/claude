/**
 * Kleiner XML-Zerleger ohne Fremdbibliothek.
 * Reicht fuer RSS/Atom, die Treasury-Zinskurve und SEC-Form-4-Dokumente.
 * Namensraum-Praefixe (z. B. "d:NEW_DATE") werden entfernt.
 */

export interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  /** Direkter Textinhalt des Knotens. */
  text: string;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeXmlEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, n) => codePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => codePoint(parseInt(n, 16)))
    .replace(/&([a-zA-Z]+);/g, (m, name) => ENTITIES[name] ?? m);
}

function codePoint(n: number): string {
  if (!Number.isFinite(n) || n < 9 || n > 0x10ffff) return "";
  try {
    return String.fromCodePoint(n);
  } catch {
    return "";
  }
}

const localName = (raw: string) => {
  const name = raw.includes(":") ? raw.slice(raw.indexOf(":") + 1) : raw;
  return name.trim();
};

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    attrs[localName(m[1])] = decodeXmlEntities(m[3] ?? m[4] ?? "");
  }
  return attrs;
}

/** Zerlegt ein XML-Dokument. Bei grobem Unsinn bleibt der Baum einfach leer. */
export function parseXml(input: string): XmlNode {
  const root: XmlNode = { name: "#document", attrs: {}, children: [], text: "" };
  const stack: XmlNode[] = [root];
  let i = 0;

  while (i < input.length) {
    const lt = input.indexOf("<", i);
    if (lt === -1) {
      addText(stack, input.slice(i));
      break;
    }
    if (lt > i) addText(stack, input.slice(i, lt));

    if (input.startsWith("<!--", lt)) {
      const end = input.indexOf("-->", lt);
      i = end === -1 ? input.length : end + 3;
      continue;
    }
    if (input.startsWith("<![CDATA[", lt)) {
      const end = input.indexOf("]]>", lt);
      const value = input.slice(lt + 9, end === -1 ? input.length : end);
      stack[stack.length - 1].text += value;
      i = end === -1 ? input.length : end + 3;
      continue;
    }
    if (input.startsWith("<?", lt) || input.startsWith("<!", lt)) {
      const end = input.indexOf(">", lt);
      i = end === -1 ? input.length : end + 1;
      continue;
    }

    const gt = input.indexOf(">", lt);
    if (gt === -1) break;
    const raw = input.slice(lt + 1, gt).trim();

    if (raw.startsWith("/")) {
      const name = localName(raw.slice(1));
      for (let s = stack.length - 1; s > 0; s--) {
        if (stack[s].name === name) {
          stack.length = s;
          break;
        }
      }
      i = gt + 1;
      continue;
    }

    const selfClosing = raw.endsWith("/");
    const body = selfClosing ? raw.slice(0, -1) : raw;
    const spaceAt = body.search(/[\s]/);
    const name = localName(spaceAt === -1 ? body : body.slice(0, spaceAt));
    const node: XmlNode = { name, attrs: spaceAt === -1 ? {} : parseAttrs(body.slice(spaceAt)), children: [], text: "" };
    stack[stack.length - 1].children.push(node);
    if (!selfClosing) stack.push(node);
    i = gt + 1;
  }
  return root;
}

function addText(stack: XmlNode[], value: string) {
  if (value.trim() === "") return;
  stack[stack.length - 1].text += decodeXmlEntities(value);
}

/** Erstes direktes Kind mit diesem Namen. */
export function child(node: XmlNode | undefined, name: string): XmlNode | undefined {
  return node?.children.find((c) => c.name === name);
}

/** Alle direkten Kinder mit diesem Namen. */
export function childrenNamed(node: XmlNode | undefined, name: string): XmlNode[] {
  return node ? node.children.filter((c) => c.name === name) : [];
}

/** Alle Knoten mit diesem Namen, beliebig tief. */
export function findAll(node: XmlNode | undefined, name: string): XmlNode[] {
  if (!node) return [];
  const out: XmlNode[] = [];
  const walk = (n: XmlNode) => {
    for (const c of n.children) {
      if (c.name === name) out.push(c);
      walk(c);
    }
  };
  walk(node);
  return out;
}

/** Text eines Knotens; `deep` bezieht Kindtexte mit ein. */
export function textOf(node: XmlNode | undefined, deep = false): string {
  if (!node) return "";
  if (!deep) return node.text.trim();
  return [node.text, ...node.children.map((c) => textOf(c, true))].join(" ").replace(/\s+/g, " ").trim();
}

/**
 * Wert eines Form-4-Feldes: dort steht der Nutzwert meist in einem
 * verschachtelten <value>-Element.
 */
export function valueOf(node: XmlNode | undefined): string | null {
  if (!node) return null;
  const inner = child(node, "value");
  const raw = inner ? textOf(inner) : textOf(node);
  return raw === "" ? null : raw;
}
