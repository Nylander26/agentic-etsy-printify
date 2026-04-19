Build production-ready Express.js servers with middleware, authentication, routing, and database integration.

Reference files with full examples: `.agents/skills/nodejs-express-server/references/`

## Quick Start

```javascript
const express = require("express");
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/health", (req, res) => {
  res.json({ status: "OK", timestamp: new Date().toISOString() });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({ error: err.message });
});

app.listen(PORT);
```

## Middleware Chain

```typescript
// Request ID + logging
app.use((req, res, next) => {
  req.id = crypto.randomUUID();
  next();
});

// Error-first middleware must have 4 params
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  res.status(500).json({ error: err.message, requestId: req.id });
});
```

## Authentication with JWT

```typescript
import jwt from "jsonwebtoken";

const authenticate = (req: Request, res: Response, next: NextFunction) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "No token" });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET!);
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
};

// Protected route
router.get("/profile", authenticate, (req, res) => {
  res.json(req.user);
});
```

## RESTful Routes Pattern

```typescript
const router = express.Router();

router.get("/", async (req, res, next) => {
  try {
    const items = await service.findAll(req.query);
    res.json(items);
  } catch (err) { next(err); }
});

router.post("/", validate(schema), async (req, res, next) => {
  try {
    const item = await service.create(req.body);
    res.status(201).json(item);
  } catch (err) { next(err); }
});

router.put("/:id", authenticate, validate(schema), async (req, res, next) => {
  try {
    const item = await service.update(req.params.id, req.body);
    if (!item) return res.status(404).json({ error: "Not found" });
    res.json(item);
  } catch (err) { next(err); }
});
```

## Input Validation (Zod)

```typescript
import { z } from "zod";

const userSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  age: z.number().int().min(0).max(150).optional(),
});

const validate = (schema: z.ZodSchema) => (req: Request, res: Response, next: NextFunction) => {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ errors: result.error.flatten() });
  }
  req.body = result.data;
  next();
};
```

## Environment Configuration

```typescript
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]),
  PORT: z.string().transform(Number),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
});

export const env = envSchema.parse(process.env);
// Fails fast at startup if env is misconfigured
```

## Rate Limiting

```typescript
import rateLimit from "express-rate-limit";

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use("/api/", limiter);
```

## Graceful Shutdown

```typescript
const server = app.listen(PORT);

process.on("SIGTERM", () => {
  server.close(async () => {
    await db.end();
    process.exit(0);
  });
});
```

## Rules

- Always use async/await — no callback hell
- Error handling: always pass to `next(err)`, never `res.send()` in catch
- Keep route handlers thin — delegate to service layer
- Validate all user input at the route level with Zod
- Use environment variables for all secrets/config
- Never run sync I/O in route handlers
