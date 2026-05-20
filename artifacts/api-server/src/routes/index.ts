import { Router, type IRouter } from "express";
import healthRouter from "./health";
import chatRouter from "./chat";
import fetchProxyRouter from "./fetch-proxy";
import conversationsRouter from "./conversations";
import accionesRouter from "./acciones";
import redaccionRouter from "./redaccion";
import coberturasRouter from "./coberturas";

const router: IRouter = Router();

router.use(healthRouter);
router.use(chatRouter);
router.use(fetchProxyRouter);
router.use(conversationsRouter);
router.use(accionesRouter);
router.use(redaccionRouter);
router.use(coberturasRouter);

export default router;
