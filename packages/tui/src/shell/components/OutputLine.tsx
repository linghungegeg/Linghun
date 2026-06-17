/**
 * OutputLine component for displaying tool output
 * Based on CCB's OutputLine behavior
 */

import { Box, Text } from "@linghun/ink-runtime";
import React, { useMemo } from "react";
import { renderTruncatedContent, tryJsonFormatContent } from "../output-utils.js";
import { linkifyUrlsInText } from "../hyperlink-utils.js";
import type { ShellTheme } from "../theme.js";

const OUTPUT_LINE_PADDING_LEFT = 2;

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
  const contentWidth = Math.max(8, terminalWidth - OUTPUT_LINE_PADDING_LEFT);
  const formattedContent = useMemo(() => {
    // Try JSON formatting
    let formatted = tryJsonFormatContent(content);

    // Linkify URLs if enabled
    if (linkifyUrls) {
      formatted = linkifyUrlsInText(formatted);
    }

    // Apply truncation if not verbose
    if (!verbose) {
      formatted = renderTruncatedContent(formatted, contentWidth, language);
    }

    return formatted;
  }, [content, verbose, linkifyUrls, contentWidth, language]);

  const color = isError
    ? theme.error
    : isWarning
      ? theme.warning
      : undefined;

  return (
    <Box paddingLeft={OUTPUT_LINE_PADDING_LEFT}>
      <Text color={color}>{formattedContent}</Text>
    </Box>
  );
}
