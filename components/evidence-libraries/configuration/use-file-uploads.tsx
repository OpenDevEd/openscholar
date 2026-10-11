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
  onInFlight,
  children,
}: {
  libraryId: Id<"evidenceLibraries">;
  /** Told 1 when an upload starts and -1 when it ends, so the page can wait for uploads before it saves. */
  onInFlight: (change: 1 | -1) => void;
  children: ReactNode;
}) {
  const generateUploadUrl = useMutation(api.evidenceLibraries.uploads.generateUploadUrl);
  const upload = useAction(api.evidenceLibraries.uploadActions.upload);
  const value: FileUploads = {
    uploadFile: async (kind, file) => {
      onInFlight(1);
      try {
        return await uploadFile({ generateUploadUrl, upload }, libraryId, kind, file);
      } finally {
        onInFlight(-1);
      }
    },
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
