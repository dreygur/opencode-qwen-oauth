/**
 * Browser utilities for opening URLs
 */

import { spawn } from "node:child_process";
import { Debouncer } from "./mutex.js";

// Debouncer to prevent multiple rapid browser opens
const browserDebouncer = new Debouncer();

/**
 * Opens a URL in the default browser
 * Supports macOS, Windows, and Linux with fallback mechanisms
 * Debounced to prevent multiple rapid calls
 */
export function openBrowser(url: string): void {
  openBrowserDebounced(url);
}

/**
 * Internal debounced browser opening function
 */
const openBrowserDebounced = browserDebouncer.debounce(
  async (url: string): Promise<void> => {
    openBrowserInternal(url);
  },
  1000, // 1 second debounce
);

/**
 * Internal function that actually opens the browser
 */
function openBrowserInternal(url: string): void {
  try {
    const platform = process.platform;
    
    let command: string;
    let args: string[];

    if (platform === "darwin") {
      // macOS
      command = "open";
      args = [url];
    } else if (platform === "win32") {
      // Windows
      command = "rundll32";
      args = ["url.dll,FileProtocolHandler", url];
    } else {
      // Linux and other Unix-like systems
      // Try xdg-open first, with fallbacks
      command = "xdg-open";
      args = [url];
      
      // Check if xdg-open exists, if not try common browsers
      const child = spawn(command, args, {
        stdio: "ignore",
        detached: true,
      });
      
      child.on("error", (error) => {
        // xdg-open failed, try common Linux browsers
        const browsers = [
          "google-chrome",
          "firefox",
          "chromium",
          "brave-browser",
          "microsoft-edge",
        ];
        
        for (const browser of browsers) {
          try {
            const browserChild = spawn(browser, [url], {
              stdio: "ignore",
              detached: true,
            });
            browserChild.unref?.();
            return; // Success, exit
          } catch {
            // Try next browser
            continue;
          }
        }
      });
      
      child.unref?.();
      return;
    }

    const child = spawn(command, args, {
      stdio: "ignore",
      detached: true,
    });
    child.unref?.();
  } catch (error) {
    // Silently fail - user can manually open the URL
  }
}
