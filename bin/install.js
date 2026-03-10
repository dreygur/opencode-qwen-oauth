#!/usr/bin/env node

/**
 * Qwen OAuth Plugin Installer
 *
 * Usage:
 *   npx opencode-qwen-oauth install
 *   bunx opencode-qwen-oauth install
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  appendFileSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// ============================================
// Helpers
// ============================================

function getProjectRoot() {
  let current = process.cwd();
  while (current !== "/") {
    if (existsSync(join(current, ".opencode"))) {
      return current;
    }
    const parent = join(current, "..");
    if (parent === current) break;
    current = parent;
  }
  return process.cwd();
}

function getOpencodeDir() {
  return join(getProjectRoot(), ".opencode");
}

function getOpencodeConfigPath() {
  return join(getOpencodeDir(), "opencode.json");
}

function ensureDir(dir) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

function log(message) {
  console.log(`[opencode-qwen-oauth] ${message}`);
}

function error(message) {
  console.error(`[opencode-qwen-oauth] ERROR: ${message}`);
}

// ============================================
// Install
// ============================================

function install() {
  log("Installing Qwen OAuth plugin...");

  const opencodeDir = getOpencodeDir();
  const configPath = getOpencodeConfigPath();

  ensureDir(opencodeDir);

  // Read or create config
  let config = {
    $schema: "https://opencode.ai/config.json",
    plugin: [],
    provider: {},
  };

  if (existsSync(configPath)) {
    try {
      const content = readFileSync(configPath, "utf-8");
      config = JSON.parse(content);
    } catch (e) {
      error(`Failed to parse ${configPath}: ${e.message}`);
      process.exit(1);
    }
  }

  // Add plugin
  config.plugin = config.plugin || [];
  if (!config.plugin.includes("opencode-qwen-oauth")) {
    config.plugin.push("opencode-qwen-oauth");
    log("Added 'opencode-qwen-oauth' to plugins");
  } else {
    log("Plugin 'opencode-qwen-oauth' already in config");
  }

  // Add provider config
  config.provider = config.provider || {};
  if (!config.provider.qwen) {
    config.provider.qwen = {
      npm: "@ai-sdk/openai-compatible",
      name: "Qwen Code",
      options: {
        baseURL: "https://portal.qwen.ai/v1",
      },
      models: {
        "coder-model": {
          id: "coder-model",
          name: "Qwen Coder",
          limit: { context: 1048576, output: 65536 },
          modalities: { input: ["text"], output: ["text"] },
        },
        "vision-model": {
          id: "vision-model",
          name: "Qwen Vision",
          limit: { context: 131072, output: 32768 },
          modalities: { input: ["text", "image"], output: ["text"] },
          attachment: true,
        },
      },
    };
    log("Added 'qwen' provider configuration");
  } else {
    log("Provider 'qwen' already configured");
  }

  // Write config
  try {
    writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
    log(`Configuration written to ${configPath}`);
  } catch (e) {
    error(`Failed to write config: ${e.message}`);
    process.exit(1);
  }

  // Install npm package in .opencode
  const opencodePackagePath = join(opencodeDir, "package.json");
  let opencodePackage = { dependencies: {} };

  if (existsSync(opencodePackagePath)) {
    try {
      opencodePackage = JSON.parse(readFileSync(opencodePackagePath, "utf-8"));
    } catch {
      // Ignore
    }
  }

  opencodePackage.dependencies = opencodePackage.dependencies || {};
  if (!opencodePackage.dependencies["opencode-qwen-oauth"]) {
    opencodePackage.dependencies["opencode-qwen-oauth"] = "^2.3.0";
    log("Added 'opencode-qwen-oauth' to .opencode/package.json dependencies");
  }

  try {
    writeFileSync(
      opencodePackagePath,
      JSON.stringify(opencodePackage, null, 2) + "\n",
      "utf-8",
    );
  } catch (e) {
    error(`Failed to write package.json: ${e.message}`);
    process.exit(1);
  }

  log("Installation complete! ✓");
  log("");
  log("Next steps:");
  log("  1. Run: opencode");
  log("  2. Connect: /connect (select 'Qwen Code (qwen.ai OAuth)')");
  log("  3. Use model: /model qwen/coder-model");
  log("     Vision model: /model qwen/vision-model");
  log("");
  log("Advanced:");
  log("  • Run diagnostics: npm run diagnose");
  log("  • View logs: tail -f ~/.config/opencode/logs/qwen-oauth.log");
  log("  • Credentials saved to: ~/.qwen/oauth_creds.json");
  log("");
}

// ============================================
// Uninstall
// ============================================

function uninstall() {
  log("Uninstalling Qwen OAuth plugin...");

  const configPath = getOpencodeConfigPath();

  if (!existsSync(configPath)) {
    log("No config file found, nothing to uninstall");
    return;
  }

  let config;
  try {
    config = JSON.parse(readFileSync(configPath, "utf-8"));
  } catch (e) {
    error(`Failed to parse config: ${e.message}`);
    process.exit(1);
  }

  // Remove plugin
  if (config.plugin) {
    const index = config.plugin.indexOf("opencode-qwen-oauth");
    if (index !== -1) {
      config.plugin.splice(index, 1);
      log("Removed 'opencode-qwen-oauth' from plugins");
    }
  }

  // Remove provider
  if (config.provider && config.provider.qwen) {
    delete config.provider.qwen;
    log("Removed 'qwen' provider configuration");
  }

  try {
    writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
    log(`Configuration updated: ${configPath}`);
  } catch (e) {
    error(`Failed to write config: ${e.message}`);
    process.exit(1);
  }

  log("Uninstallation complete!");
  log("Note: You may want to manually remove the npm package:");
  log("npm uninstall opencode-qwen-auth");
}

// ============================================
// Main
// ============================================

const command = process.argv[2];

if (command === "install" || !command) {
  install();
} else if (command === "uninstall") {
  uninstall();
} else if (command === "--help" || command === "-h") {
  console.log(`
opencode-qwen-oauth - Qwen OAuth Plugin for OpenCode

Usage:
  npx opencode-qwen-oauth install      Install the plugin (default)
  npx opencode-qwen-oauth uninstall    Remove the plugin
  npx opencode-qwen-oauth --help       Show this help

After installation:
  1. Run: opencode
  2. Connect: /connect (select 'Qwen Code (qwen.ai OAuth)')
  3. Use model: /model qwen/coder-model

Models:
  - coder-model: Qwen Coder (1M context, 64K output)
  - vision-model: Qwen Vision (128K context, 32K output, supports images)

Logs:
  - tail -f ~/.config/opencode/logs/qwen-oauth.log
`);
} else {
  error(`Unknown command: ${command}`);
  console.log("Run 'npx opencode-qwen-auth --help' for usage");
  process.exit(1);
}
