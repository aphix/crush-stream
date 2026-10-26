import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db";
import { handleSubmissions } from "@/lib/submissions/submissions.server";

const handle = ({ request }: { request: Request }) =>
  handleSubmissions(request, getSql, process.env.SUBMISSIONS_OWNER_TOKEN?.trim() || undefined);

export const Route = createFileRoute("/api/submissions")({
  server: { handlers: { GET: handle, POST: handle } },
});
