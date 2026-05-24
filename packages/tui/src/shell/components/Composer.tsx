import { Box, Text, useInput } from "ink";
import type React from "react";
import { useState } from "react";
import { fitText } from "../text-utils.js";
import type { ShellInputEvent, ShellViewModel } from "../types.js";

type ComposerProps = {
  view: ShellViewModel;
  onInput: (event: ShellInputEvent) => void | Promise<void>;
};

type ComposerKey = {
  escape?: boolean;
  return?: boolean;
  shift?: boolean;
  backspace?: boolean;
  delete?: boolean;
  ctrl?: boolean;
  meta?: boolean;
};

type ComposerDecision =
  | { kind: "set"; text: string }
  | { kind: "append"; text: string }
  | { kind: "emit"; event: ShellInputEvent; nextText: string }
  | { kind: "ignore" };

export function Composer({ view, onInput }: ComposerProps): React.ReactNode {
  const [text, setText] = useState("");
  const maxWidth = Math.min(80, Math.max(30, view.width - 4));

  useInput((input, key) => {
    const decision = handleComposerInput(text, input, key);
    if (decision.kind === "emit") {
      setText(decision.nextText);
      void onInput(decision.event);
    } else if (decision.kind === "set") {
      setText(decision.text);
    } else if (decision.kind === "append") {
      setText((value) => `${value}${decision.text}`);
    }
  });

  const displayLines = text
    ? formatComposerText(text, view.composer.masking).split("\n")
    : [view.composer.placeholder];
  const color = text ? "white" : "gray";

  return (
    <Box width="100%" flexDirection="column">
      {displayLines.map((line, index) => {
        const isLastLine = index === displayLines.length - 1;
        const visibleLine = text && isLastLine ? `${line}\u258C` : line;
        return (
          <Text key={`${index}-${line}`} color={color} bold={Boolean(text)}>
            {fitText(visibleLine, maxWidth)}
          </Text>
        );
      })}
    </Box>
  );
}

function formatComposerText(text: string, masking: boolean): string {
  return masking ? "*".repeat(Array.from(text).length) : text;
}

export function handleComposerInput(
  text: string,
  input: string,
  key: ComposerKey,
): ComposerDecision {
  if (key.escape) {
    return { kind: "emit", event: { type: "escape" }, nextText: "" };
  }
  if (key.return && key.shift) {
    return { kind: "append", text: "\n" };
  }
  if (key.return) {
    const submitted = text.trim();
    return {
      kind: "emit",
      event: submitted ? { type: "submit", text: submitted } : { type: "empty-submit" },
      nextText: "",
    };
  }
  if (key.backspace || key.delete) {
    return { kind: "set", text: Array.from(text).slice(0, -1).join("") };
  }
  if (key.ctrl || key.meta || input === "\r" || input === "\n") {
    return { kind: "ignore" };
  }
  if (input) {
    return { kind: "append", text: input };
  }
  return { kind: "ignore" };
}
