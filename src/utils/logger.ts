/**
 * Logging utilities for Qwen OAuth plugin
 */

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  service: string;
  level: LogLevel;
  message: string;
  extra?: Record<string, unknown>;
}

type AppLogger = {
  app: {
    log: (entry: { body: LogEntry }) => Promise<void>;
  };
};

let appLogger: AppLogger | null = null;

export function setLoggerClient(client: { app: { log: (entry: { body: LogEntry }) => Promise<void> } }): void {
  appLogger = client;
}

export async function log(
  level: LogLevel,
  message: string,
  data?: Record<string, unknown>,
): Promise<void> {
  try {
    if (appLogger) {
      await appLogger.app.log({
        body: {
          service: "qwen-oauth",
          level,
          message,
          extra: data,
        },
      });
    } else {
      console.log(`[${level}] ${message}`, data || "");
    }
  } catch {
    console.log(`[${level}] ${message}`, data || "");
  }
}

export const debugLog = (message: string, data?: Record<string, unknown>) => log("debug", message, data);
export const infoLog = (message: string, data?: Record<string, unknown>) => log("info", message, data);
export const warnLog = (message: string, data?: Record<string, unknown>) => log("warn", message, data);
export const errorLog = (message: string, data?: Record<string, unknown>) => log("error", message, data);
