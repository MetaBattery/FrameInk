export const logger = {
    debug: (component: string, message: string, data?: any) => {
      console.log(`[${component}] ${message}`, data ? data : '');
    },
    error: (component: string, message: string, error: any) => {
      console.error(`[${component}] ${message}:`, error);
      if (error?.stack) {
        console.error(`[${component}] Stack:`, error.stack);
      }
    }
  };