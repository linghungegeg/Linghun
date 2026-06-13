/**
 * OutputLine component for displaying tool output
 * Based on CCB's OutputLine behavior
 */

import { Box, Text } from "@linghun/ink-runtime";
import React, { useMemo } from "react";
import { renderTruncatedContent, tryJsonFormatContent } from "../output-utils.js";
import { linkifyUrlsInText } from "../hyperlink-utils.js";
import type { ShellTheme } from "../theme.js";

type OutputLineProps = {
  content: string;
  verbose: boolean;
  isError?: boolean;
  isWarning?: boolean;
  linkifyUrls?: boolean;
  theme: ShellTheme;
  terminalWidth: number;
  language?: "zh-CN" | "en-US";
};

export function OutputLine({
  content,
  verbose,
  isError,
  isWarning,
  linkifyUrls = true,
  theme,
  terminalWidth,
  language = "zh-CN",
}: OutputLineProps): React.ReactNode {
  const formattedContent = useMemo(() => {
    // Try JSON formatting
    let formatted = tryJsonFormatContent(content);

    // Linkify URLs if enabled
    if (linkifyUrls) {
      formatted = linkifyUrlsInText(formatted);
    }

    // Apply truncation if not verbose
    if (!verbose) {
      formatted = renderTruncatedContent(formatted, terminalWidth, language);
    }

    return formatted;
  }, [content, verbose, linkifyUrls, terminalWidth, language]);

  const color = isError
    ? theme.error
    : isWarning
      ? theme.warning
      : undefined;

  return (
    <Box paddingLeft={2}>
      <Text color={color}>{formattedContent}</Text>
    </Box>
  );
}
