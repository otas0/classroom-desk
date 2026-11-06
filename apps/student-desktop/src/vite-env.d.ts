/// <reference types="vite/client" />

import type { StudentDesktopAPI } from '../electron/preload';

declare global {
  interface Window {
    classroomDesk: StudentDesktopAPI;
  }
}

export {};
