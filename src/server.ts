import { buildApp } from "./app";

const app = buildApp();
const HOST = "0.0.0.0";
const MAX_PORT_RETRIES = 10;

const start = async () => {
  try {
    await app.ready();
    const envPort = Number(process.env.PORT);
    let selectedPort = Number.isFinite(envPort) && envPort > 0 ? envPort : app.config.PORT;

    for (let attempt = 0; attempt <= MAX_PORT_RETRIES; attempt += 1) {
      try {
        await app.listen({ port: selectedPort, host: HOST });
        app.log.info(`Backend running on http://localhost:${selectedPort}`);
        return;
      } catch (error) {
        const listenError = error as NodeJS.ErrnoException;
        const isPortConflict = listenError?.code === "EADDRINUSE";
        if (!isPortConflict || attempt === MAX_PORT_RETRIES) {
          throw error;
        }
        app.log.warn(`Port ${selectedPort} is in use. Retrying with port ${selectedPort + 1}...`);
        selectedPort += 1;
      }
    }
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
