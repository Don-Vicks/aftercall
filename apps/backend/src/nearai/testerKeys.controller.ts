import { Body, Controller, Get, HttpCode, Inject, Post, Req } from "@nestjs/common";
import { clientIp, type IpRequest } from "../clientIp";
import { TesterKeys } from "./testerKeys";

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
  issue(@Body() body: { installId?: unknown }, @Req() req: IpRequest) {
    return this.keys.issue(body?.installId, clientIp(req));
  }
}
