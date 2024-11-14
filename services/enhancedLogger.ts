export interface EnhancedLogMessage {
    timestamp: string;
    level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
    component: string;
    message: string;
    data?: any;
    error?: Error;
  }
  
  export class EnhancedLogger {
    private static logBuffer: EnhancedLogMessage[] = [];
    private static readonly MAX_BUFFER_SIZE = 1000;
  
    private static formatTimestamp(): string {
      return new Date().toISOString();
    }
  
    private static formatData(data: any): string {
      try {
        return JSON.stringify(data, (key, value) => {
          if (value instanceof Error) {
            return {
              name: value.name,
              message: value.message,
              stack: value.stack,
            };
          }
          if (value instanceof Uint8Array) {
            return Array.from(value)
              .map(byte => byte.toString(16).padStart(2, '0'))
              .join(':');
          }
          return value;
        }, 2);
      } catch (error) {
        return String(data);
      }
    }
  
    private static log(level: EnhancedLogMessage['level'], component: string, message: string, data?: any, error?: Error) {
      const logMessage: EnhancedLogMessage = {
        timestamp: this.formatTimestamp(),
        level,
        component,
        message,
        data: data ? this.formatData(data) : undefined,
        error,
      };
  
      // Add to buffer
      this.logBuffer.push(logMessage);
      if (this.logBuffer.length > this.MAX_BUFFER_SIZE) {
        this.logBuffer.shift();
      }
  
      // Also log to console with formatting
      const consoleMessage = `[${logMessage.timestamp}] [${level}] [${component}] ${message}`;
      switch (level) {
        case 'ERROR':
          console.error(consoleMessage, data, error?.stack);
          break;
        case 'WARN':
          console.warn(consoleMessage, data);
          break;
        case 'INFO':
          console.info(consoleMessage, data);
          break;
        default:
          console.log(consoleMessage, data);
      }
    }
  
    static debug(component: string, message: string, data?: any) {
      this.log('DEBUG', component, message, data);
    }
  
    static info(component: string, message: string, data?: any) {
      this.log('INFO', component, message, data);
    }
  
    static warn(component: string, message: string, data?: any) {
      this.log('WARN', component, message, data);
    }
  
    static error(component: string, message: string, error?: Error, data?: any) {
      this.log('ERROR', component, message, data, error);
    }
  
    static getLogs(): EnhancedLogMessage[] {
      return [...this.logBuffer];
    }
  
    static exportLogs(): string {
      return this.logBuffer
        .map(log => `${log.timestamp} [${log.level}] [${log.component}] ${log.message}${
          log.data ? '\nData: ' + log.data : ''
        }${log.error ? '\nError: ' + log.error.stack : ''}`)
        .join('\n');
    }
  }