import express, { type Express } from "express";
import { resolve } from "path";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// In production, serve the built frontend from web-terminal
const frontendDist = resolve(__dirname, "../../web-terminal/dist/public");
app.use(express.static(frontendDist));
app.use((_req, res) => {
  res.sendFile(resolve(frontendDist, "index.html"));
});

export default app;
