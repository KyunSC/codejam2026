import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "storage/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { rules: { "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }] } },
  { files: ["src/web/**/*.{ts,tsx}"], plugins: { "react-hooks": reactHooks }, rules: reactHooks.configs.recommended.rules, languageOptions: { globals: globals.browser } },
  { files: ["src/server/**", "src/services/**", "src/lib/**", "scripts/**", "*.config.*"], languageOptions: { globals: globals.node } },
);
