import { buildApp } from "./app";

const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 3001);

const app = buildApp();

app.listen({ host, port }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
