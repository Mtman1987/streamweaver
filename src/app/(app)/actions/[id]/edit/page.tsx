import ActionEditor from "./ActionEditor";

export default async function EditActionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ActionEditor actionId={id} />;
}
