import { use } from "react";
import CoachPage from "../page";

export default function CoachConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <CoachPage initialConvId={id} />;
}
