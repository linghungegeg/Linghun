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

  const value = text || view.composer.placeholder;
  return (
    <Box
      flexDirection="column"
      borderStyle={compact ? undefined : "round"}
      paddingX={compact ? 0 : 1}
    >
      <Text>
        {view.composer.prompt}&gt; {value}
      </Text>
      <Text color="gray">{view.composer.hint}</Text>
      {view.width < 45 ? (
        <Text color="gray">Shift+Enter fallback: paste newline text, then Enter.</Text>
      ) : null}
    </Box>
  );
}
