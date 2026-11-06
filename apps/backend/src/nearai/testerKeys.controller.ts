import { Body, Controller, Get, HttpCode, Inject, Post, Req } from "@nestjs/common";
import { TesterKeys } from "./testerKeys";

/** The parts of Express's request this reads. */
type Request = { headers: Record<string, string | string[] | undefined>; socket: { remoteAddress?: string } };

/** The caller's address: the first hop Vercel's proxy saw, else the socket's. */
function clientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim();
  return first || req.socket.remoteAddress || "unknown";
}

@Controller("nearai")
export class TesterKeysController {
  constructor(@Inject(TesterKeys) private readonly keys: TesterKeys) {}

  /** Whether the app should offer "Use Aftercall's test credits", and each key's limit. */
  @Get("test-credits")
  status() {
    return this.keys.status();
  }

  /** One capped NEAR AI key for this install. The key is in the reply and nowhere else. */
  @Post("test-key")
  @HttpCode(200)
  issue(@Body() body: { installId?: unknown }, @Req() req: Request) {
    return this.keys.issue(body?.installId, clientIp(req));
  }
}
