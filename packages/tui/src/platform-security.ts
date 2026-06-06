import { basename, resolve } from "node:path";

export const DANGEROUS_FILES = new Set([
  ".bashrc",
  ".zshrc",
  ".profile",
  ".gitconfig",
  ".npmrc",
  ".pypirc",
  ".netrc",
  "credentials",
  "credentials.json",
  "id_rsa",
  "id_ed25519",
]);

export const DANGEROUS_DIRECTORIES = new Set([
  ".git",
  ".ssh",
  ".gnupg",
  ".aws",
  ".azure",
  ".gcloud",
]);

const DOS_DEVICE_NAMES = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;

export function getPlatformPathDenyReason(path: string, workspaceRoot: string): string | null {
  const normalized = path.replaceAll("\\", "/");
  if (normalized.includes(":") && /:[^/\\]+$/u.test(normalized)) {
    return `安全保护：拒绝 Windows ADS alternate data stream 路径：${path}。`;
  }
  if (/(?:^|[/\\])[^/\\]*~[0-9](?:[/\\.]|$)/u.test(path)) {
    return `安全保护：拒绝 Windows 8.3 short-name 路径：${path}。`;
  }
  const fileName = basename(normalized).toLowerCase();
  if (DOS_DEVICE_NAMES.test(fileName)) {
    return `安全保护：拒绝 Windows DOS device 路径：${path}。`;
  }
  if (/^(?:\\\\[.?]\\|\/\/[.?]\/)/u.test(path)) {
    return `安全保护：拒绝 Windows device namespace 路径：${path}。`;
  }
  const absolute = resolve(workspaceRoot, path);
  const loweredAbsolute = absolute.replaceAll("\\", "/").toLowerCase();
  const segments = normalized.toLowerCase().split("/").filter(Boolean);
  if (segments.some((segment) => DANGEROUS_DIRECTORIES.has(segment))) {
    return `安全保护：拒绝危险目录路径：${path}。`;
  }
  if (DANGEROUS_FILES.has(fileName)) {
    return `安全保护：拒绝危险配置或密钥文件：${path}。`;
  }
  if (loweredAbsolute.includes("/.git/") || loweredAbsolute.endsWith("/.git")) {
    return "安全保护：禁止修改 .git 目录。";
  }
  return null;
}
