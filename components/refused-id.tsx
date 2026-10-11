"use client";

import { Component, type ReactNode } from "react";

/** Whether the server turned a call down because an argument that has to be an ID isn't one. */
const notAnId = (error: unknown) => error instanceof Error && error.message.includes("ArgumentValidationError") && error.message.includes("v.id(");

type Props = { id: string | null; onRefused: () => void; children: ReactNode };

/**
 * An ID a page takes from its address can be anything: a link cut short, a typo, another kind's
 * ID. The server's validator refuses it, which would put the whole-site error screen up. Around
 * the page, this catches that refusal and tells the page (`onRefused`), which then shows what it
 * shows for an item that is gone (#826). It stands empty until the page answers by changing `id`,
 * and every other error passes through to the boundary above.
 */
export class RefusedId extends Component<Props, { id: string | null; error: unknown }> {
  state = { id: this.props.id, error: undefined as unknown };
  static getDerivedStateFromProps(props: Props, state: { id: string | null }) {
    return props.id === state.id ? null : { id: props.id, error: undefined };
  }
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  componentDidCatch(error: unknown) {
    if (this.props.id !== null && notAnId(error)) this.props.onRefused();
  }
  render() {
    if (this.state.error === undefined) return this.props.children;
    if (this.state.id === null || !notAnId(this.state.error)) throw this.state.error;
    return null;
  }
}
