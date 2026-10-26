import { Controller, Get, Header, Inject } from "@nestjs/common";
import { StatsService } from "./stats.service";

@Controller("stats")
export class StatsController {
  constructor(@Inject(StatsService) private readonly stats: StatsService) {}

  /** Public counts, no accounts or content. Cached for 60 s here and by browsers. */
  @Get()
  @Header("cache-control", "public, max-age=60")
  get() {
    return this.stats.get();
  }
}
