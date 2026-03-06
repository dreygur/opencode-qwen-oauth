/**
 * Logging utilities for Qwen OAuth Plugin
 */

import { appendFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { sanitizeLogData } from "./validation.js";

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

function getLogDir(): string {
  const xdgConfig = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(xdgConfig, "opencode", "logs");
}

function getLogFilePath(): string {
  return join(getLogDir(), "qwen-oauth.log");
}

function ensureLogDir(): void {
  const logDir = getLogDir();
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true, mode: 0o700 });
  }
}

function getCurrentLogLevel(): LogLevel {
  const level = process.env.QWEN_OAUTH_LOG_LEVEL?.toUpperCase();
  switch (level) {
    case "ERROR":
      return LogLevel.ERROR;
    case "WARN":
      return LogLevel.WARN;
    case "INFO":
      return LogLevel.INFO;
    case "DEBUG":
      return LogLevel.DEBUG;
    default:
      // Default to INFO, unless DEBUG env var is set
      return process.env.QWEN_OAUTH_DEBUG === "true"
        ? LogLevel.DEBUG
        : LogLevel.INFO;
  }
}

function writeLog(level: LogLevel, message: string, data?: any): void {
  try {
    const currentLevel = getCurrentLogLevel();
    if (level < currentLevel) {
      return; // Skip logs below current level
    }

    ensureLogDir();
    const timestamp = new Date().toISOString();
    const levelName = LogLevel[level];
    
    // Sanitize sensitive data
    const sanitizedData = data ? sanitizeLogData(data) : undefined;
    const dataStr = sanitizedData ? ` ${JSON.stringify(sanitizedData)}` : "";
    
    const logLine = `[${timestamp}] [${levelName}] ${message}${dataStr}\n`;
    appendFileSync(getLogFilePath(), logLine, { encoding: "utf-8" });
  } catch {
    // Silently ignore log write errors
  }
}

export const DEBUG =
  process.env.QWEN_OAUTH_DEBUG === "true" ||
  process.env.QWEN_OAUTH_DEBUG === "1";

export function debugLog(message: string, data?: Record<string, unknown>): void {
  writeLog(LogLevel.DEBUG, message, data);
}

export function infoLog(message: string, data?: Record<string, unknown>): void {
  writeLog(LogLevel.INFO, message, data);
}

export function warnLog(message: string, data?: Record<string, unknown>): void {
  writeLog(LogLevel.WARN, message, data);
}

export function errorLog(message: string, data?: Record<string, unknown>): void {
  writeLog(LogLevel.ERROR, message, data);
}
