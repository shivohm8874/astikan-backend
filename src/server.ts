import { buildApp } from "./app";

const app = buildApp();

const start = async () => {
  try {
    await app.ready();
    await app.listen({ port: app.config.PORT, host: "0.0.0.0" });
    app.log.info(`Backend running on http://localhost:${app.config.PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
