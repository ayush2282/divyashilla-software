import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({mode}) => {
  const env=loadEnv(mode,process.cwd(),'');
  const target=env.BACKEND_PROXY_TARGET || 'http://127.0.0.1:3000';
  if(!/^https?:\/\//.test(target)) throw new Error('BACKEND_PROXY_TARGET must be an HTTP(S) URL.');
  // Preserve Origin so backend origin/CSRF validation remains effective.
  const proxy={'/api':{target,changeOrigin:false}};
  return {plugins:[react()],server:{host:'127.0.0.1',port:5173,strictPort:true,proxy},
    preview:{host:'127.0.0.1',port:5173,strictPort:true,proxy}};
});
