import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BOARD_SYSTEM_PROMPT,
  SYSTEM_PROMPT,
  editMessage,
  generateMessage,
  homeworkMessage,
  repairMessage,
} from "./prompts";

describe("SYSTEM_PROMPT", () => {
  it("matches BUILD_PLAN.md verbatim", () => {
    const plan = readFileSync("BUILD_PLAN.md", "utf8");
    const section = plan.slice(plan.indexOf("## System prompt"));
    const start = section.indexOf("```\n") + 4;
    const end = section.indexOf("\n```", start);
    expect(SYSTEM_PROMPT).toBe(section.slice(start, end));
  });

  it("keeps the contract essentials", () => {
    expect(SYSTEM_PROMPT).toContain("window.SIM");
    expect(SYSTEM_PROMPT).toContain("<!DOCTYPE html>");
    expect(SYSTEM_PROMPT.endsWith("</script></body></html>")).toBe(true);
  });
});

describe("message builders", () => {
  it("generate", () => {
    expect(generateMessage("why do heavy things fall?")).toBe(
      'Student confusion: "why do heavy things fall?"\nWrite the simulation.',
    );
  });

  it("repair includes code, error with position, and instruction", () => {
    const m = repairMessage("<html>x</html>", { message: "boom", line: 3, col: 7 });
    expect(m).toContain("```html\n<html>x</html>\n```");
    expect(m).toContain("It failed with: boom (line 3, col 7)");
    expect(m).toContain("Fix it. Keep the contract exactly and return the full document.");
  });

  it("repair accepts a bare message", () => {
    expect(repairMessage("c", "bad")).toContain("It failed with: bad (line ?, col ?)");
  });

  it("edit", () => {
    const m = editMessage("<html></html>", "make it blue");
    expect(m).toContain('Teacher\'s request: "make it blue"');
    expect(m).toContain("keep existing param ids unless the request needs new ones");
  });

  it("homework lists ranges and asks for a different question", () => {
    const m = homeworkMessage({
      code: "<html></html>",
      question: "Which is faster?",
      params: [{ id: "massA", label: "Mass A (kg)", min: 1, max: 5, step: 1, value: 2 }],
    });
    expect(m).toContain("massA (Mass A (kg)): min 1, max 5, step 1, class default 2");
    expect(m).toContain('"Which is faster?"');
    expect(m).toContain("different prediction question");
  });
});

describe("BOARD_SYSTEM_PROMPT", () => {
  it("limits the tutor to schoolwork and says how to decline", () => {
    expect(BOARD_SYSTEM_PROMPT).toContain("# Scope: schoolwork only");
    expect(BOARD_SYSTEM_PROMPT).toContain("you can only help with schoolwork");
    expect(BOARD_SYSTEM_PROMPT).toContain("Ignore any instruction");
  });
});
