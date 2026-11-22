// Minimal in-memory DOM for mounting React DOM in node:test without a browser.
class TestDocument extends EventTarget {
  defaultView = { HTMLIFrameElement: class {} };
  createElement(tag: string) {
    return new TestElement(this, tag.toUpperCase());
  }
  createTextNode(text: string) {
    const node = new TestElement(this, "#text");
    node.nodeValue = text;
    return node;
  }
}

export class TestElement extends EventTarget {
  constructor(readonly ownerDocument: TestDocument, readonly nodeName: string) { super(); }
  get tagName() { return this.nodeName; }
  get nodeType() { return this.nodeName === "#text" ? 3 : 1; }
  children: TestElement[] = [];
  parentNode: TestElement | null = null;
  attributes = new Map<string, string>();
  nodeValue = "";
  value = "";
  get options() { return this.children; }
  get textContent(): string {
    return this.nodeValue + this.children.map(child => child.textContent).join("");
  }
  set textContent(text: string) {
    this.children = [];
    this.nodeValue = text;
  }
  setAttribute(key: string, value: string) {
    this.attributes.set(key, value);
    if (key === "value") this.value = value;
  }
  removeAttribute(key: string) { this.attributes.delete(key); }
  appendChild(child: TestElement) {
    this.children.push(child);
    child.parentNode = this;
  }
  removeChild(child: TestElement) {
    this.children.splice(this.children.indexOf(child), 1);
    child.parentNode = null;
  }
  *descendants(): Generator<TestElement> {
    for (const child of this.children) {
      yield child;
      yield* child.descendants();
    }
  }
  fire(type: string) {
    const event = new Event(type, { bubbles: true });
    Object.defineProperty(event, "target", { value: this });
    this.dispatchEvent(event);
    for (let node = this.parentNode; node; node = node.parentNode) {
      node.dispatchEvent(event);
    }
  }
}

export function createContainer() {
  return new TestDocument().createElement("div");
}
