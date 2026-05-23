import { permanentRedirect } from "next/navigation";

export default function UseCasesIndexPage() {
  permanentRedirect("/questions");
}
