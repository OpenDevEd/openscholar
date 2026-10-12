"use client";

import { createContext, useContext } from "react";

/**
 * Set when the reader only reads a library's settings (#653): its cards show their values with no
 * state or reset, and the controls a disabled fieldset doesn't reach, uploads, rich text and
 * dragging, are off too.
 */
export const ReadOnlyContext = createContext(false);

export const useReadOnly = () => useContext(ReadOnlyContext);
