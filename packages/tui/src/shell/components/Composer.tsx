import { Box, Text, useInput } from "ink";
import type React from "react";
import { useState } from "react";
import type { ShellInputEvent, ShellViewModel } from "../types.js";

type ComposerProps = {
  view: ShellViewModel;
  onInput: (event: ShellInputEvent) => void | Promise<void>;
};

export function Composer({ view, onInput }: ComposerProps): React.ReactNode {
  const [text, setText] = useState("");
  const compact = view.width < 60;

  useInput((input, key) => {
    if (key.escape) {
      void onInput({ type: "escape" });
      setText("");
      return;
    }
    if (key.return) {
      const submitted = text.trim();
      setText("");
      void onInput(submitted ? { type: "submit", text: submitted } : { type: "empty-submit" });
      return;
    }
    if (key.backspace || key.delete) {
      setText((value) => Array.from(value).slice(0, -1).join(""));
      return;
    }
    if (key.ctrl || key.meta || input === "\r" || input === "\n") {
      return;
    }
    if (input) {
      setText((value) => `${value}${input}`);
    }
  });

  const value = text ? formatComposerText(text, view.composer.masking) : view.composer.placeholder;
  const promptColor = text ? "white" : "gray";
  return (
    <Box flexDirection="column" width="100%">
      <Box>
        <Text color={promptColor}>
          {view.composer.prompt} &gt; {fitText(value, compact ? view.width - 4 : 80)}
        </Text>
      </Box>
      <Text color="gray">
        {compact ? fitText(view.composer.hint, view.width - 2) : view.composer.hint}
      </Text>
      {view.width < 45 ? (
        <Text color="gray">Shift+Enter fallback: paste newline text, then Enter.</Text>
      ) : null}
    </Box>
  );
}

function formatComposerText(text: string, masking: boolean): string {
  return masking ? "*".repeat(Array.from(text).length) : text;
}

function fitText(value: string, max: number): string {
  if (max <= 0) return "";
  const chars = Array.from(value.replace(/\s+/gu, " ").trim());
  let width = 0;
  let result = "";
  for (const char of chars) {
    const next = width + charWidth(char);
    if (next > max) return `${result}…`;
    result += char;
    width = next;
  }
  return result;
}

function charWidth(char: string): number {
  return /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/u.test(
    char,
  )
    ? 2
    : 1;
}
