import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { createContainer } from "./test-dom";
import { renderToStaticMarkup } from "react-dom/server";
import type { InvoiceLine } from "../../src/lib/types";
import { EditableLinesTable, LinesTable } from "../../src/web/components/InvoiceLines";

const depts = [
  { department_id: "OPS", name: "Operations" },
  { department_id: "SALES", name: "Sales" },
];

function line(line_no: number, amount: number, department_id?: string | null): InvoiceLine {
  return { line_no, amount, department_id, quantity: 1, unit_price: amount, description: "Test charge" };
}

function render(lines: InvoiceLine[], currency: string) {
  return renderToStaticMarkup(createElement(LinesTable, { lines, currency, depts, gls: [] }));
}

function splitRows(html: string) {
  const section = html.match(/<section [^>]*aria-label="Department split"[^>]*>(.*?)<\/section>/s);
  assert.ok(section, "Department split is visible");
  return Array.from(section[1].matchAll(/<dt>(.*?)<\/dt><dd[^>]*>(.*?)<\/dd>/gs),
    ([, label, amount]) => [label, amount.replace(/\s+/g, " ")]);
}

const invoice = {
  currency: "USD",
  lines: [line(1, 80, "OPS"), line(2, 20, "OPS"), line(3, 50, "SALES")],
  taxes: [{ label: "Tax", amount: 15 }],
  total: 165,
};
const savedRows = [
  ["Operations · 2 lines", "USD 100.00"],
  ["Sales · 1 line", "USD 50.00"],
  ["Line subtotal", "USD 150.00"],
];

test("a viewer sees saved line amounts in invoice currency, excluding header tax", () => {
  const html = render(invoice.lines, invoice.currency);
  assert.deepEqual(splitRows(html), savedRows);
  assert.doesNotMatch(html, /<(?:select|button|input)\b/);
});

test("changing and discarding a department updates the split and preserves the saved lines", (t) => {
  const container = createContainer();
  Object.defineProperty(globalThis, "window", { configurable: true, value: container.ownerDocument.defaultView });
  const root = createRoot(container as unknown as HTMLElement);
  t.after(async () => {
    root.unmount();
    await new Promise<void>(resolve => setImmediate(resolve));
    Reflect.deleteProperty(globalThis, "window");
  });
  flushSync(() => root.render(createElement(EditableLinesTable, { ...invoice, depts, gls: [] })));

  function displayedRows() {
    const section = [...container.descendants()].find(el => el.attributes.get("aria-label") === "Department split");
    assert.ok(section);
    const list = section.children.find(el => el.tagName === "DL");
    assert.ok(list);
    return list.children.map(row => row.children.map(cell => cell.textContent.replace(/\s+/g, " ")));
  }

  assert.deepEqual(displayedRows(), savedRows);
  const selector = [...container.descendants()].find(el =>
    el.tagName === "SELECT" && el.attributes.get("aria-label") === "Department for line 2");
  assert.ok(selector);
  selector.value = "SALES";
  flushSync(() => selector.fire("change"));
  assert.deepEqual(displayedRows(), [
    ["Operations · 1 line", "USD 80.00"],
    ["Sales · 2 lines", "USD 70.00"],
    ["Line subtotal", "USD 150.00"],
  ]);

  const discard = [...container.descendants()].find(el =>
    el.tagName === "BUTTON" && el.textContent === "Discard department edits");
  assert.ok(discard);
  flushSync(() => discard.fire("click"));
  assert.deepEqual(displayedRows(), savedRows);
});

for (const amount of [30, 10.125]) {
  test(`offsetting unassigned CAD lines of ±${amount} remain visible at zero`, () => {
    assert.deepEqual(splitRows(render([line(1, amount), line(2, -amount, null)], "CAD")), [
      ["Unassigned · 2 lines", "CAD 0.00"],
      ["Line subtotal", "CAD 0.00"],
    ]);
  });
}

test("a half-cent credit in another department offsets the displayed charge", () => {
  assert.deepEqual(splitRows(render([line(1, 10.125, "OPS"), line(2, -10.125, "SALES")], "CAD")), [
    ["Operations · 1 line", "CAD 10.13"],
    ["Sales · 1 line", "-CAD 10.13"],
    ["Line subtotal", "CAD 0.00"],
  ]);
});
