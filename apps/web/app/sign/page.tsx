import { SignClient } from "./SignClient";

export const metadata = { title: "Sign · Aftercall", description: "Sign an agent-wallet change with your own NEAR wallet" };

export default function SignPage() {
  return <SignClient />;
}
