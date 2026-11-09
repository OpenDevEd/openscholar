import { citeFileResponse } from "@/lib/papers/cite-file";

export const GET = (_request: Request, { params }: { params: Promise<{ id: string }> }) => citeFileResponse(params, "bibtex");
