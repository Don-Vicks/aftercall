import { DealClient } from "./DealClient";

export const metadata = { title: "Confirm a deal · Aftercall", description: "Check a payment agreed on a call against NEAR, and confirm it with your own wallet" };

export default function DealPage() {
  return <DealClient />;
}
