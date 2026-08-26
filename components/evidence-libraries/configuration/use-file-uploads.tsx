"use client";

import { useAction, useMutation } from "convex/react";
import { createContext, type ReactNode, useContext } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { type UploadKind, type UploadResult, uploadFile } from "./upload-file";

type FileUploads = {
  uploadFile: (kind: UploadKind, file: File) => Promise<UploadResult>;
};

const FileUploadsContext = createContext<FileUploads | null>(null);

/** Gives every upload control on the page the library it uploads for. */
export function FileUploadsProvider({
  libraryId,
  children,
}: {
  libraryId: Id<"evidenceLibraries">;
  children: ReactNode;
}) {
  const generateUploadUrl = useMutation(api.evidenceLibraries.uploads.generateUploadUrl);
  const upload = useAction(api.evidenceLibraries.uploadActions.upload);
  const value: FileUploads = {
    uploadFile: (kind, file) => uploadFile({ generateUploadUrl, upload }, libraryId, kind, file),
  };
  return (
    <FileUploadsContext.Provider value={value}>{children}</FileUploadsContext.Provider>
  );
}

export function useFileUploads(): FileUploads {
  const value = useContext(FileUploadsContext);
  if (!value) {
    throw new Error("useFileUploads needs a FileUploadsProvider above it");
  }
  return value;
}
