type LogLevel = "info" | "warn" | "error";
type LogContext = Record<string, unknown>;

function normalizeContext(context?: LogContext): LogContext | undefined {
  if (!context) {
    return undefined;
  }

  return Object.fromEntries(Object.entries(context).filter(([, value]) => value !== undefined));
}

function write(level: LogLevel, scope: string, event: string, message: string, context?: LogContext) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    scope,
    event,
    message,
    ...normalizeContext(context),
  };

  const payload = JSON.stringify(entry);

  if (level === "error") {
    console.error(payload);
    return;
  }

  if (level === "warn") {
    console.warn(payload);
    return;
  }

  console.log(payload);
}

export function errorContext(error: unknown) {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: error.message,
    };
  }

  return {
    errorMessage: String(error),
  };
}

export function createLogger(scope: string) {
  return {
    info(event: string, message: string, context?: LogContext) {
      write("info", scope, event, message, context);
    },
    warn(event: string, message: string, context?: LogContext) {
      write("warn", scope, event, message, context);
    },
    error(event: string, message: string, context?: LogContext) {
      write("error", scope, event, message, context);
    },
  };
}
