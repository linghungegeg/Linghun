export const prompt =
  "Use Bash for verification and project commands after considering risk. Prefer read-only commands unless the user asked for changes and permissions allow them. Prefer python3 over bare python; probe imports before relying on optional Python packages. After starting a server, poll the port or health endpoint and inspect logs before claiming it is ready.";
