import { Router, type IRouter } from "express";
import healthRouter from "./health";
import chatRouter from "./chat";
import fetchProxyRouter from "./fetch-proxy";
import conversationsRouter from "./conversations";

const router: IRouter = Router();

router.use(healthRouter);
router.use(chatRouter);
router.use(fetchProxyRouter);
router.use(conversationsRouter);

export default router;
