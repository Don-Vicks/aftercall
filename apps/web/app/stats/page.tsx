import { StatsClient } from "./StatsClient";

export const metadata = { title: "Stats · Aftercall", description: "How much Aftercall has been used, in counts only" };

export default function StatsPage() {
  return <StatsClient />;
}
