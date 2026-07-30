import EditorialEntryForm, { type EditorialSeriesOption } from "@/components/editorial/EditorialEntryForm";

interface EditorialCreateFormProps {
  seriesOptions: EditorialSeriesOption[];
}

export type { EditorialSeriesOption };

export default function EditorialCreateForm({ seriesOptions }: EditorialCreateFormProps) {
  return <EditorialEntryForm seriesOptions={seriesOptions} />;
}
