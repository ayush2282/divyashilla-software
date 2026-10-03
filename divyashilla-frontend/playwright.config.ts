import { defineConfig } from '@playwright/test';
export default defineConfig({testDir:'./tests',testMatch:'**/*.spec.ts',fullyParallel:false,workers:1,timeout:30000,
  use:{baseURL:'http://localhost:5173',browserName:'chromium',launchOptions:{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH},trace:'retain-on-failure'},
  webServer:[{command:'node --import ../divyashilla-backend/node_modules/tsx/dist/loader.mjs tests/start-backend.ts',url:'http://127.0.0.1:3180/health/ready',reuseExistingServer:false,timeout:60000},
    {command:'npm run dev',url:'http://localhost:5173',env:{BACKEND_PROXY_TARGET:'http://127.0.0.1:3180'},reuseExistingServer:false,timeout:30000}]
});
