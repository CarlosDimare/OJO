import { Router } from "express";

const router = Router();

router.get("/fetch-proxy", async (req, res) => {
  const url = req.query.url as string | undefined;
  if (!url || !/^https?:\/\//i.test(url)) {
    res.status(400).json({ error: "Invalid URL" });
    return;
  }

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "es-AR,es;q=0.9,en;q=0.8",
      },
    });

    if (!response.ok) {
      res.status(502).json({ error: `El sitio respondió con código ${response.status}` });
      return;
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
      res.status(400).json({ error: "La URL no es una página HTML" });
      return;
    }

    let html = await response.text();
    if (html.length > 1024 * 1024) {
      res.status(413).json({ error: "La página es demasiado grande (>1MB)" });
      return;
    }

    html = html.replace(/<script[\s\S]*?<\/script>/gi, "");
    html = html.replace(/<noscript[\s\S]*?<\/noscript>/gi, "");
    html = html.replace(/<iframe[\s\S]*?<\/iframe>/gi, "");
    html = html.replace(/on\w+="[^"]*"/gi, "");
    html = html.replace(/on\w+='[^']*'/gi, "");
    html = html.replace(/<base[^>]*>/gi, "");

    html = html.replace(
      /<head>/i,
      `<head><base href="${url.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}">`,
    );

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("X-Frame-Options", "ALLOWALL");
    res.send(html);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: msg });
  }
});

export default router;
