import { Body, Controller, Delete, Get, Headers, HttpCode, Inject, Param, Post, Query, Req } from "@nestjs/common";
import { clientIp, type IpRequest } from "../clientIp";
import { RelayService } from "./relay.service";

type Box = { box?: unknown };

/**
 * The phone relay's routes (docs/design/phone-protocol.md, "The relay"). `:id` is the
 * pairing id's base64url text; tokens go in `authorization: Bearer <token>`. Bodies hold
 * sealed boxes, and nothing but the fields named here is read.
 */
@Controller("relay/pairings")
export class RelayController {
  constructor(@Inject(RelayService) private readonly relay: RelayService) {}

  /** The Mac makes a pairing for its QR code. */
  @Post()
  create(@Body() body: { id?: unknown; macTokenHash?: unknown }, @Req() req: IpRequest) {
    return this.relay.create(body?.id, body?.macTokenHash, clientIp(req));
  }

  /** The phone posts its sealed hello. */
  @Post(":id/hello")
  @HttpCode(200)
  async postHello(@Param("id") id: string, @Body() body: Box, @Req() req: IpRequest) {
    await this.relay.postHello(id, body, clientIp(req));
    return { ok: true };
  }

  /** The Mac waits for the phone's hello. */
  @Get(":id/hello")
  hello(@Param("id") id: string, @Headers("authorization") authorization: string | undefined) {
    return this.relay.hello(id, authorization);
  }

  /** The Mac confirms the codes matched, with the hash of the phone's token. */
  @Post(":id/confirm")
  @HttpCode(200)
  async confirm(@Param("id") id: string, @Headers("authorization") authorization: string | undefined, @Body() body: { phoneTokenHash?: unknown }) {
    await this.relay.confirm(id, authorization, body?.phoneTokenHash);
    return { ok: true };
  }

  /** The Mac replaces the snapshot. */
  @Post(":id/snapshot")
  @HttpCode(200)
  postSnapshot(@Param("id") id: string, @Headers("authorization") authorization: string | undefined, @Body() body: Box) {
    return this.relay.postSnapshot(id, authorization, body);
  }

  /** The phone polls for a newer snapshot. */
  @Get(":id/snapshot")
  snapshot(@Param("id") id: string, @Headers("authorization") authorization: string | undefined, @Query("after") after: unknown) {
    return this.relay.snapshot(id, authorization, after);
  }

  /** The phone sends one sealed tap. */
  @Post(":id/actions")
  @HttpCode(200)
  postAction(@Param("id") id: string, @Headers("authorization") authorization: string | undefined, @Body() body: Box) {
    return this.relay.postAction(id, authorization, body);
  }

  /** The Mac collects the waiting taps. */
  @Get(":id/actions")
  actions(@Param("id") id: string, @Headers("authorization") authorization: string | undefined) {
    return this.relay.actions(id, authorization);
  }

  /** The Mac has handled the taps up to `seq`. */
  @Post(":id/ack")
  @HttpCode(200)
  async ack(@Param("id") id: string, @Headers("authorization") authorization: string | undefined, @Body() body: { seq?: unknown }) {
    await this.relay.ack(id, authorization, body?.seq);
    return { ok: true };
  }

  /** Either side unpairs. */
  @Delete(":id")
  async unpair(@Param("id") id: string, @Headers("authorization") authorization: string | undefined) {
    await this.relay.unpair(id, authorization);
    return { ok: true };
  }
}
