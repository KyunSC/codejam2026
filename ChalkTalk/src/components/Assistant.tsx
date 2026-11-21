"use client";

import { createContext, useContext } from "react";

/** The assistant's name ("Claude", "ChatGPT", "Gemini", "AI"), set from LLM_PROVIDER on the server. */
const AssistantName = createContext("Claude");

export const AssistantProvider = AssistantName.Provider;

export function useAssistant(): string {
  return useContext(AssistantName);
}
