/**
 * Browser utilities for opening URLs
 */

import { spawn } from "node:child_process";

export function openBrowser(url: string): void {
  try {
    const platform = process.platform;
    const command =
      platform === "darwin"
        ? "open"
        : platform === "win32"
          ? "rundll32"
          : "xdg-open";
    const args =
      platform === "win32" ? ["url.dll,FileProtocolHandler", url] : [url];
    const child = spawn(command, args, {
      stdio: "ignore",
      detached: true,
    });
    child.unref?.();
  } catch {
    // Ignore errors
  }
}
