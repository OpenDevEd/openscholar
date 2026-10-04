"use client";

import { Markdown } from "@tiptap/markdown";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extension-placeholder";
import { Bold, Italic, Link2, List, Unlink } from "@/components/icons";
import { type ReactNode, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { Field, labelId } from "./section-card";

const HTTPS = /^(https:\/\/|mailto:|\/)/;

/**
 * Text an owner writes for the public site, with the little formatting the site shows: bold, italic, links and
 * bulleted lists. Stored as Markdown, so the library renders it with the Markdown it already reads.
 */
export function RichTextField({
  label,
  hint,
  suffix,
  value,
  onChange,
  maxLength,
  placeholder,
  lists = true,
  minRows = 3,
}: {
  label: ReactNode;
  hint?: ReactNode;
  suffix?: ReactNode;
  value: string;
  onChange: (markdown: string) => void;
  maxLength: number;
  placeholder?: string;
  /** Allow bulleted lists; short answers leave them out. */
  lists?: boolean;
  minRows?: number;
}) {
  return (
    <Field
      label={label}
      hint={hint}
      suffix={suffix}
      counter={`${value.length} / ${maxLength}`}
      error={value.length > maxLength ? `Keep this under ${maxLength} characters.` : null}
    >
      {(id, invalid) => (
        <RichTextEditor
          id={id}
          invalid={invalid}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          lists={lists}
          minRows={minRows}
        />
      )}
    </Field>
  );
}

function RichTextEditor({
  id,
  invalid,
  value,
  onChange,
  placeholder,
  lists,
  minRows,
}: {
  id: string;
  invalid: boolean;
  value: string;
  onChange: (markdown: string) => void;
  placeholder?: string;
  lists: boolean;
  minRows: number;
}) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: false,
        blockquote: false,
        codeBlock: false,
        code: false,
        horizontalRule: false,
        strike: false,
        underline: false,
        bulletList: lists ? {} : false,
        orderedList: false,
        listItem: lists ? {} : false,
        listKeymap: lists ? {} : false,
        link: { openOnClick: false, autolink: true, defaultProtocol: "https" },
      }),
      Placeholder.configure({ placeholder: placeholder ?? "" }),
      Markdown,
    ],
    content: value,
    contentType: "markdown",
    editorProps: {
      attributes: {
        id,
        "aria-labelledby": labelId(id),
        role: "textbox",
        "aria-multiline": "true",
        "aria-invalid": invalid ? "true" : "false",
        class: cn(
          "w-full px-3 py-2 text-base outline-none md:text-sm",
          "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_p+p]:mt-2 [&_strong]:font-semibold",
          "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_li>p]:my-0",
          "[&_p.is-editor-empty:first-child]:before:pointer-events-none [&_p.is-editor-empty:first-child]:before:float-left [&_p.is-editor-empty:first-child]:before:h-0 [&_p.is-editor-empty:first-child]:before:text-muted-foreground [&_p.is-editor-empty:first-child]:before:content-[attr(data-placeholder)]",
        ),
        style: `min-height: ${minRows * 1.5 + 1}rem`,
      },
    },
    onUpdate: ({ editor: current }) => onChange(current.getMarkdown()),
  });
  // The value can change from outside the editor, as when the card is reset.
  useEffect(() => {
    if (editor && value !== editor.getMarkdown()) {
      editor.commands.setContent(value, { contentType: "markdown", emitUpdate: false });
    }
  }, [editor, value]);
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current?.isActive("bold") ?? false,
      italic: current?.isActive("italic") ?? false,
      link: current?.isActive("link") ?? false,
      list: current?.isActive("bulletList") ?? false,
      href: (current?.getAttributes("link").href as string | undefined) ?? "",
    }),
  });

  return (
    <div
      className={cn(
        "rounded-md border border-input bg-field shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50",
        invalid && "border-destructive ring-destructive/20",
      )}
    >
      <div className="flex items-center gap-0.5 border-b border-border-subtle px-1.5 py-1" role="toolbar" aria-label="Formatting">
        <ToolButton label="Bold" active={state?.bold} onClick={() => editor?.chain().focus().toggleBold().run()}>
          <Bold />
        </ToolButton>
        <ToolButton label="Italic" active={state?.italic} onClick={() => editor?.chain().focus().toggleItalic().run()}>
          <Italic />
        </ToolButton>
        <LinkButton
          active={state?.link ?? false}
          href={state?.href ?? ""}
          onApply={(href) => editor?.chain().focus().extendMarkRange("link").setLink({ href }).run()}
          onRemove={() => editor?.chain().focus().extendMarkRange("link").unsetLink().run()}
        />
        {lists ? (
          <ToolButton label="Bulleted list" active={state?.list} onClick={() => editor?.chain().focus().toggleBulletList().run()}>
            <List />
          </ToolButton>
        ) : null}
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}

function ToolButton({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          aria-pressed={active ?? false}
          onMouseDown={(event) => event.preventDefault()}
          onClick={onClick}
          className={cn("text-muted-foreground", active && "bg-accent text-foreground")}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** A link is an address typed into a small popover; the selected words become the link text. */
function LinkButton({ active, href, onApply, onRemove }: { active: boolean; href: string; onApply: (href: string) => void; onRemove: () => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const valid = HTTPS.test(draft.trim());
  const apply = () => {
    if (!valid) return;
    onApply(draft.trim());
    setOpen(false);
  };
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setDraft(href || "https://");
      }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Link"
              aria-pressed={active}
              onMouseDown={(event) => event.preventDefault()}
              className={cn("text-muted-foreground", active && "bg-accent text-foreground")}
            >
              <Link2 />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Link</TooltipContent>
      </Tooltip>
      <PopoverContent align="start" className="flex w-80 flex-col gap-2 p-3">
        <Input
          autoFocus
          value={draft}
          inputMode="url"
          placeholder="https://"
          aria-label="Link address"
          aria-invalid={draft.trim() !== "" && !valid ? true : undefined}
          className="font-mono text-sm"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              apply();
            }
          }}
        />
        <div className="flex items-center justify-between gap-2">
          {active ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                onRemove();
                setOpen(false);
              }}
            >
              <Unlink />
              Remove link
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">Addresses start with https://</span>
          )}
          <Button type="button" size="sm" disabled={!valid} onClick={apply}>
            {active ? "Update" : "Add link"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
