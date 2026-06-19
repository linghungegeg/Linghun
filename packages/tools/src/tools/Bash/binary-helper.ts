import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, stat } from "node:fs/promises";
import type { ToolOutput } from "../../index.js";

export type BashBinaryInspectInput = {
  path: string;
  previewBytes?: number;
};

type BinaryDiagnostic = {
  type: "artifact_preservation" | "binary_tool_missing";
  severity: "recoverable" | "blocking";
  evidence: string;
  suggestion: string;
};

const DEFAULT_PREVIEW_BYTES = 64;
const MAX_PREVIEW_BYTES = 512;
const ELF64_HEADER_BYTES = 64;
const SQLITE_HEADER = "SQLite format 3\0";

export async function inspectBinaryFile(
  input: BashBinaryInspectInput,
  targetPath: string,
): Promise<ToolOutput> {
  const previewBytes = Math.min(input.previewBytes ?? DEFAULT_PREVIEW_BYTES, MAX_PREVIEW_BYTES);
  try {
    const fileStat = await stat(targetPath);
    const header = await readFileHeader(
      targetPath,
      Math.min(fileStat.size, Math.max(previewBytes, ELF64_HEADER_BYTES, SQLITE_HEADER.length)),
    );
    const preview = header.subarray(0, previewBytes);
    const magic = detectMagic(header);
    const elf = magic.type === "elf" ? parseElf(header) : undefined;
    const sha256 = await hashFileSha256(targetPath);
    const text = [
      `Binary inspect ${input.path}`,
      `size ${fileStat.size}`,
      `sha256 ${sha256}`,
      `magic ${magic.label}`,
      elf ? formatElfSummary(elf) : "",
      `hex ${formatHex(preview)}`,
      `ascii ${formatAscii(preview)}`,
    ].filter(Boolean).join("\n");

    return {
      text,
      data: {
        exitCode: 0,
        outcome: "binary_inspected",
        binary: {
          path: targetPath,
          size: fileStat.size,
          sha256,
          previewBytes: preview.length,
          hexPreview: formatHex(preview),
          asciiPreview: formatAscii(preview),
          magic,
          ...(elf ? { elf } : {}),
        },
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const diagnostic: BinaryDiagnostic = {
      type: "artifact_preservation",
      severity: "blocking",
      evidence: `binary inspect failed for ${input.path}: ${message}`,
      suggestion: "Verify the file path and preserve expected input artifacts before retrying.",
    };
    return {
      text: [
        `Binary inspect failed ${input.path}`,
        diagnostic.evidence,
      ].join("\n"),
      data: {
        exitCode: 1,
        outcome: "binary_inspect_failed",
        diagnostics: [diagnostic],
      },
    };
  }
}

function detectMagic(content: Buffer): { type: string; label: string } {
  if (content.length >= 4 && content[0] === 0x7f && content[1] === 0x45 && content[2] === 0x4c && content[3] === 0x46) {
    return { type: "elf", label: "ELF executable/shared object" };
  }
  if (content.length >= 2 && content[0] === 0x1f && content[1] === 0x8b) {
    return { type: "gzip", label: "gzip compressed data" };
  }
  if (content.length >= 4 && content[0] === 0x50 && content[1] === 0x4b && content[2] === 0x03 && content[3] === 0x04) {
    return { type: "zip", label: "zip archive" };
  }
  if (content.length >= 6 && content[0] === 0x37 && content[1] === 0x7a && content[2] === 0xbc && content[3] === 0xaf && content[4] === 0x27 && content[5] === 0x1c) {
    return { type: "7z", label: "7z archive" };
  }
  if (content.length >= 8 && content[0] === 0x89 && content[1] === 0x50 && content[2] === 0x4e && content[3] === 0x47 && content[4] === 0x0d && content[5] === 0x0a && content[6] === 0x1a && content[7] === 0x0a) {
    return { type: "png", label: "PNG image" };
  }
  if (content.length >= 3 && content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff) {
    return { type: "jpeg", label: "JPEG image" };
  }
  if (content.length >= 4 && content.subarray(0, 4).toString("ascii") === "%PDF") {
    return { type: "pdf", label: "PDF document" };
  }
  if (content.length >= SQLITE_HEADER.length && content.subarray(0, SQLITE_HEADER.length).toString("binary") === SQLITE_HEADER) {
    return { type: "sqlite", label: "SQLite database" };
  }
  return { type: "unknown", label: "unknown binary/text" };
}

function parseElf(content: Buffer) {
  const elfClass = content[4] === 1 ? "32" : content[4] === 2 ? "64" : "unknown";
  const requiredBytes = elfClass === "64" ? 64 : 52;
  if (content.length < requiredBytes) {
    return { error: "ELF header is truncated" };
  }
  const endian = content[5] === 1 ? "little" : content[5] === 2 ? "big" : "unknown";
  const littleEndian = endian !== "big";
  const readUInt16 = (offset: number) => littleEndian ? content.readUInt16LE(offset) : content.readUInt16BE(offset);
  const readUInt32 = (offset: number) => littleEndian ? content.readUInt32LE(offset) : content.readUInt32BE(offset);
  const readUInt64 = (offset: number) => {
    const value = littleEndian ? content.readBigUInt64LE(offset) : content.readBigUInt64BE(offset);
    return `0x${value.toString(16)}`;
  };

  const is64 = elfClass === "64";
  return {
    class: elfClass,
    endianness: endian,
    type: elfTypeName(readUInt16(16)),
    machine: elfMachineName(readUInt16(18)),
    entry: is64 ? readUInt64(24) : `0x${readUInt32(24).toString(16)}`,
    programHeaderOffset: is64 ? readUInt64(32) : `0x${readUInt32(28).toString(16)}`,
    sectionHeaderOffset: is64 ? readUInt64(40) : `0x${readUInt32(32).toString(16)}`,
    headerSize: readUInt16(is64 ? 52 : 40),
    programHeaderEntrySize: readUInt16(is64 ? 54 : 42),
    programHeaderCount: readUInt16(is64 ? 56 : 44),
    sectionHeaderEntrySize: readUInt16(is64 ? 58 : 46),
    sectionHeaderCount: readUInt16(is64 ? 60 : 48),
    sectionNameStringTableIndex: readUInt16(is64 ? 62 : 50),
  };
}

function formatElfSummary(elf: ReturnType<typeof parseElf>): string {
  if ("error" in elf) {
    return `elf ${elf.error}`;
  }
  return `elf ${elf.class} ${elf.endianness} type=${elf.type} machine=${elf.machine} entry=${elf.entry}`;
}

async function readFileHeader(path: string, bytes: number): Promise<Buffer> {
  if (bytes <= 0) return Buffer.alloc(0);
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(bytes);
    const result = await handle.read(buffer, 0, bytes, 0);
    return buffer.subarray(0, result.bytesRead);
  } finally {
    await handle.close();
  }
}

async function hashFileSha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

function elfTypeName(value: number): string {
  return ({ 0: "none", 1: "relocatable", 2: "executable", 3: "shared", 4: "core" } as Record<number, string>)[value] ?? `unknown(${value})`;
}

function elfMachineName(value: number): string {
  return ({ 3: "x86", 40: "arm", 62: "x86-64", 183: "aarch64", 243: "riscv" } as Record<number, string>)[value] ?? `unknown(${value})`;
}

function formatHex(buffer: Buffer): string {
  return [...buffer].map((byte) => byte.toString(16).padStart(2, "0")).join(" ");
}

function formatAscii(buffer: Buffer): string {
  return [...buffer].map((byte) => byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : ".").join("");
}
