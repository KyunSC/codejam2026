// The board tools, as JSON Schema. The same list drives Ask Claude and the MCP server (which adds board_id).

const obj = (properties: Record<string, unknown>, required: string[]) => ({
  type: "object" as const,
  properties,
  required,
  additionalProperties: false,
});
const pos = {
  x: { type: "number", description: "Left edge in board pixels. Leave out to let the app place it." },
  y: { type: "number", description: "Top edge in board pixels. Leave out to let the app place it." },
};
const id = { type: "string", description: "The item id, as listed by get_board." };

export const BOARD_TOOLS = [
  {
    name: "get_board",
    description: "Read the board: its title and every item (id, kind, author, position, content, sliders).",
    input_schema: obj({}, []),
  },
  {
    name: "get_changelog",
    description: "Read what the student, Claude and the app did on the board, newest last.",
    input_schema: obj({ limit: { type: "integer", description: "How many recent entries (default 40, at most 300)." } }, []),
  },
  {
    name: "add_note",
    description: "Write a new note on the board.",
    input_schema: obj({ text: { type: "string", description: "Plain words, a few sentences at most." }, ...pos }, ["text"]),
  },
  {
    name: "update_note",
    description: "Replace the text of any note.",
    input_schema: obj({ id, text: { type: "string" } }, ["id", "text"]),
  },
  {
    name: "add_sim",
    description:
      "Place a new interactive simulation box. Another model writes the simulation from the prompt, in the browser that has the board open.",
    input_schema: obj({ prompt: { type: "string", description: "The confusion or experiment, in a teacher's words." }, ...pos }, ["prompt"]),
  },
  {
    name: "edit_sim",
    description: "Ask for a change to a simulation box, in plain words.",
    input_schema: obj({ id, request: { type: "string" } }, ["id", "request"]),
  },
  {
    name: "set_sliders",
    description: "Set a simulation's sliders by slider id. Values are kept within each slider's range.",
    input_schema: obj(
      { id, values: { type: "object", additionalProperties: { type: "number" }, description: "{ sliderId: number }" } },
      ["id", "values"],
    ),
  },
  {
    name: "move_item",
    description: "Move any item so its top-left corner is at (x, y).",
    input_schema: obj({ id, x: { type: "number" }, y: { type: "number" } }, ["id", "x", "y"]),
  },
  {
    name: "delete_item",
    description: "Remove any item from the board.",
    input_schema: obj({ id }, ["id"]),
  },
  {
    name: "rename_board",
    description: "Change the board's title.",
    input_schema: obj({ title: { type: "string" } }, ["title"]),
  },
];

export type BoardToolName = (typeof BOARD_TOOLS)[number]["name"];
