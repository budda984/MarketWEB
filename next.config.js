/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: { bodySizeLimit: '2mb' },
  },
  env: {
    // Identificativo della versione pubblicata. Vercel imposta
    // VERCEL_GIT_COMMIT_SHA a ogni build: mostrarlo in pagina permette di
    // capire subito se il browser sta servendo una versione vecchia dalla
    // cache oppure se il deploy non e' andato a buon fine.
    NEXT_PUBLIC_BUILD_SHA: (process.env.VERCEL_GIT_COMMIT_SHA || 'locale').slice(0, 7),
    NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
  },
};

module.exports = nextConfig;
