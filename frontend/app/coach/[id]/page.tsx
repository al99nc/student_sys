import CoachPage from "../page";

export default function CoachConversationPage({ params }: { params: { id: string } }) {
  return <CoachPage initialConvId={params.id} />;
}
