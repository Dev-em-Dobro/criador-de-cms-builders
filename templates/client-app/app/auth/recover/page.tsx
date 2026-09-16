import clientConfig from "@/client.config";
import RecoverForm from "./RecoverForm";

/**
 * Self-service password recovery — the entry point that removes "editor forgot
 * their password" from the engineering queue (SC-006). Deliberately public:
 * the endpoint behind it answers identically whether or not the address is
 * registered.
 */
export default function RecoverPage() {
  return <RecoverForm brandTitle={clientConfig.branding.adminTitle} />;
}
