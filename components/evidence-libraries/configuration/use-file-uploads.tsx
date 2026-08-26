"use client";

import { useAction, useMutation } from "convex/react";
import { createContext, type ReactNode, useContext } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import {
  type UploadKind,
  type UploadResult,
  uploadFile,
  uploadFunctions,
} from "./upload-file";

type FileUploads = {
  uploadFile: (kind: UploadKind, file: File) => Promise<UploadResult>;
  /** Best effort: deletes a stored file the owner replaced or removed. */
  removeFile: (url: string) => Promise<void>;
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
  const generateUploadUrl = useMutation(uploadFunctions.generateUploadUrl);
  const upload = useAction(uploadFunctions.upload);
  const remove = useAction(uploadFunctions.remove);
  const value: FileUploads = {
    uploadFile: (kind, file) =>
      uploadFile({ generateUploadUrl, upload, remove }, libraryId, kind, file),
    removeFile: (url) => remove({ libraryId, url }).then(() => undefined, () => undefined),
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
